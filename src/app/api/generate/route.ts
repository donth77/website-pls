import { NextRequest, NextResponse } from "next/server";
import { screenUserPromptWithLakera } from "@/lib/ai/lakera";
import { validateUserPrompt } from "@/lib/ai/promptSafety";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db/prisma";
import { ProjectStatus } from "@/generated/prisma/enums";
import { getGenerationQueue } from "@/lib/queue/generationQueue";
import {
  ensureGuestSession,
  consumeGuestGeneration,
} from "@/lib/auth/guestSession";

const baseLog = createLogger("api:generate");

const MAX_PROJECT_NAME_LEN = 60;

/** Derive a short project name from the user's prompt. */
function generateProjectName(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_PROJECT_NAME_LEN) return trimmed;
  // Cut at the last word boundary before the limit
  const cut = trimmed.slice(0, MAX_PROJECT_NAME_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "\u2026";
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = baseLog.child({ requestId });

  try {
    const body = await req.json();
    const prompt = String(body?.prompt ?? "").trim();
    const existingProjectId = body?.projectId as string | undefined;
    const refinementPrompt = body?.refinementPrompt
      ? String(body.refinementPrompt).trim()
      : undefined;
    const turnstileToken = body?.turnstileToken as string | undefined;
    const isRefinement = !!(existingProjectId && refinementPrompt);

    // Validate the relevant prompt text.
    const textToValidate = isRefinement ? refinementPrompt! : prompt;
    const promptIssue = validateUserPrompt(textToValidate);
    if (promptIssue) {
      return NextResponse.json(
        { error: promptIssue, code: "VALIDATION" },
        { status: 400 },
      );
    }

    // Resolve client IP for rate limiting.
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Cloudflare Turnstile bot verification (before rate limit so bots
    // don't consume slots).
    const turnstile = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: turnstile.message, code: turnstile.code },
        { status: turnstile.httpStatus },
      );
    }

    // Ensure the caller has a guest session (or authenticated user).
    const sessionResult = await ensureGuestSession(clientIp);
    if (!sessionResult.ok) {
      return NextResponse.json(
        { error: sessionResult.error, code: sessionResult.code },
        { status: sessionResult.httpStatus },
      );
    }
    const owner = sessionResult.owner;

    // Per-IP rate limiting: 10 generations per hour (secondary layer).
    try {
      const rateLimitKey =
        owner.type === "guest"
          ? `generate:guest:${owner.guestSessionId}`
          : `generate:user:${owner.userId}`;
      const rl = await checkRateLimit({
        key: rateLimitKey,
        limit: 10,
        windowSeconds: 3600,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "Rate limit exceeded. Try again later.",
            code: "RATE_LIMIT",
          },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
    } catch (err) {
      // If Redis is down, allow the request through (fail-open).
      log.warn("Rate limit check failed, allowing request", {
        error: String(err),
      });
    }

    // Enforce generation limits (atomic operations).
    if (owner.type === "guest") {
      const gen = await consumeGuestGeneration(owner.guestSessionId);
      if (!gen.allowed) {
        return NextResponse.json(
          {
            error: "You've used all your free generations. Sign up for more!",
            code: "GENERATION_LIMIT",
          },
          { status: 403 },
        );
      }
    } else if (owner.type === "user") {
      // Atomic credit decrement: only succeeds if credits > 0.
      const result = await prisma.$queryRawUnsafe<{ credits: number }[]>(
        `UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits`,
        owner.userId,
      );
      if (result.length === 0) {
        return NextResponse.json(
          {
            error: "No credits remaining.",
            code: "GENERATION_LIMIT",
          },
          { status: 403 },
        );
      }
    }

    const lakera = await screenUserPromptWithLakera(textToValidate, {
      forwardedFor: req.headers.get("x-forwarded-for"),
    });
    if (!lakera.ok) {
      return NextResponse.json(
        { error: lakera.message, code: lakera.code },
        { status: lakera.httpStatus },
      );
    }

    let projectId: string;
    let projectName: string;
    let versionId: string;
    let versionNumber: number;

    if (isRefinement) {
      // Iterate on an existing project: look it up and create the next version.
      const existing = await prisma.project.findUnique({
        where: { id: existingProjectId },
        select: {
          id: true,
          name: true,
          guestSessionId: true,
          userId: true,
          versions: {
            orderBy: { versionNumber: "desc" as const },
            take: 1,
            select: { id: true, versionNumber: true, storageKey: true },
          },
        },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Project not found.", code: "VALIDATION" },
          { status: 404 },
        );
      }

      // Verify the caller owns this project (security #3).
      const ownsProject =
        (owner.type === "guest" &&
          existing.guestSessionId === owner.guestSessionId) ||
        (owner.type === "user" && existing.userId === owner.userId);
      if (!ownsProject) {
        return NextResponse.json(
          { error: "Forbidden.", code: "FORBIDDEN" },
          { status: 403 },
        );
      }

      const latestVersion = existing.versions[0];
      versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      // Atomic: update project status + create version in one transaction.
      const [, version] = await prisma.$transaction([
        prisma.project.update({
          where: { id: existing.id },
          data: { status: ProjectStatus.GENERATING },
        }),
        prisma.version.create({
          data: {
            projectId: existing.id,
            versionNumber,
            promptDelta: refinementPrompt,
          },
        }),
      ]);

      projectId = existing.id;
      projectName = existing.name;
      versionId = version.id;
    } else {
      // New generation: create project + first version atomically.
      const [project, version] = await prisma.$transaction(async (tx) => {
        const p = await tx.project.create({
          data: {
            name: generateProjectName(prompt),
            prompt,
            status: ProjectStatus.GENERATING,
            ...(owner.type === "guest"
              ? { guestSessionId: owner.guestSessionId }
              : {}),
            ...(owner.type === "user" ? { userId: owner.userId } : {}),
          },
        });
        const v = await tx.version.create({
          data: {
            projectId: p.id,
            versionNumber: 1,
          },
        });
        return [p, v] as const;
      });

      projectId = project.id;
      projectName = project.name;
      versionId = version.id;
      versionNumber = 1;
    }

    const queue = getGenerationQueue();
    await queue.add(
      "generate-html",
      {
        projectId,
        versionId,
        userPrompt: prompt,
        refinementPrompt: isRefinement ? refinementPrompt : undefined,
        requestId,
      },
      {
        jobId: versionId,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    log.info("Generation enqueued", {
      projectId,
      versionId,
      versionNumber,
      isRefinement,
    });

    return NextResponse.json({
      projectId,
      projectName,
      versionId,
      versionNumber,
      status: ProjectStatus.GENERATING,
    });
  } catch (err) {
    log.error("Generation enqueue failed", { error: String(err) });
    return NextResponse.json(
      { error: "Generation enqueue failed." },
      { status: 500 },
    );
  }
}
