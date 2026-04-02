import { NextRequest, NextResponse } from "next/server";
import { screenUserPromptWithLakera } from "@/lib/ai/lakera";
import { validateUserPrompt } from "@/lib/ai/promptSafety";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db/prisma";
import { ProjectStatus } from "@/generated/prisma/enums";
import { getGenerationQueue } from "@/lib/queue/generationQueue";

const baseLog = createLogger("api:generate");

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

    // Per-IP rate limiting: 10 generations per hour.
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

    try {
      const rl = await checkRateLimit({
        key: `generate:${clientIp}`,
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
    let versionNumber: number;

    let secretToken: string;

    if (isRefinement) {
      // Iterate on an existing project: look it up and create the next version.
      const existing = await prisma.project.findUnique({
        where: { id: existingProjectId },
        select: {
          id: true,
          secretToken: true,
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
      projectId = existing.id;
      secretToken = existing.secretToken;
      const latestVersion = existing.versions[0];
      versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      await prisma.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.GENERATING },
      });
    } else {
      // New generation: create a fresh project.
      const project = await prisma.project.create({
        data: {
          name: "Anonymous Demo",
          prompt,
          status: ProjectStatus.GENERATING,
        },
      });
      projectId = project.id;
      secretToken = project.secretToken;
      versionNumber = 1;
    }

    const version = await prisma.version.create({
      data: {
        projectId,
        versionNumber,
        promptDelta: isRefinement ? refinementPrompt : undefined,
      },
    });

    const queue = getGenerationQueue();
    await queue.add(
      "generate-html",
      {
        projectId,
        versionId: version.id,
        userPrompt: prompt,
        refinementPrompt: isRefinement ? refinementPrompt : undefined,
        requestId,
      },
      {
        jobId: version.id,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnFail: { count: 50 },
      },
    );

    log.info("Generation enqueued", {
      projectId,
      versionId: version.id,
      versionNumber,
      isRefinement,
    });

    return NextResponse.json({
      projectId,
      versionId: version.id,
      versionNumber,
      secretToken,
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
