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
import { ErrorCode } from "@/lib/types";
import { resolveClientIp } from "@/lib/clientIp";
import { validateCsrf } from "@/lib/csrf";
import { recordEvent, recordRateLimitHit } from "@/lib/admin/metrics";
import { uploadFile } from "@/lib/storage/r2";
import {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
} from "@/lib/rag/extract";

const baseLog = createLogger("api:generate");

const RATE_LIMIT_GUEST = parseInt(
  process.env.RATE_LIMIT_GUEST_PER_HR ?? "10",
  10,
);
const RATE_LIMIT_USER = parseInt(
  process.env.RATE_LIMIT_USER_PER_HR ?? "20",
  10,
);
const RATE_LIMIT_BYOK = parseInt(
  process.env.RATE_LIMIT_BYOK_PER_HR ?? "60",
  10,
);
const MONETIZATION_ENABLED = process.env.ENABLE_MONETIZATION === "true";

/** Will the worker generate an LLM title? */
const TITLE_GENERATION_AVAILABLE = !!process.env.OPENROUTER_API_KEY;

export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req, "POST /api/generate");
  if (csrfError) return csrfError;

  const requestId = crypto.randomUUID();
  const log = baseLog.child({ requestId });

  try {
    const contentType = req.headers.get("content-type") ?? "";
    const isMultipart = contentType.startsWith("multipart/form-data");

    // Size gate for multipart bodies before reading the request body — a
    // request that's already over the cap shouldn't read its own file.
    if (isMultipart) {
      const contentLengthHeader = req.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : 0;
      // 10 MB file + ~1 MB headroom for multipart framing / other fields.
      if (contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
        return NextResponse.json(
          {
            error: "Request body too large (max 10 MB).",
            code: ErrorCode.VALIDATION,
          },
          { status: 413 },
        );
      }
    }

    let prompt: string;
    let existingProjectId: string | undefined;
    let refinementPrompt: string | undefined;
    let turnstileToken: string | undefined;
    let uploadedFile: File | undefined;

    if (isMultipart) {
      const form = await req.formData();
      prompt = String(form.get("prompt") ?? "").trim();
      const projectIdField = form.get("projectId");
      existingProjectId = projectIdField ? String(projectIdField) : undefined;
      const refField = form.get("refinementPrompt");
      refinementPrompt = refField ? String(refField).trim() : undefined;
      const tokenField = form.get("turnstileToken");
      turnstileToken = tokenField ? String(tokenField) : undefined;
      const fileField = form.get("file");
      if (fileField instanceof File && fileField.size > 0) {
        uploadedFile = fileField;
      }
    } else {
      const body = await req.json();
      prompt = String(body?.prompt ?? "").trim();
      existingProjectId = body?.projectId as string | undefined;
      refinementPrompt = body?.refinementPrompt
        ? String(body.refinementPrompt).trim()
        : undefined;
      turnstileToken = body?.turnstileToken as string | undefined;
    }

    const isRefinement = !!(existingProjectId && refinementPrompt);

    // Defense in depth: validate file constraints immediately, before any
    // rate-limit / Lakera / R2 round-trip. A bad file fails fast.
    if (uploadedFile) {
      if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          {
            error: "Reference file too large (max 10 MB).",
            code: ErrorCode.VALIDATION,
          },
          { status: 413 },
        );
      }
      if (
        !(SUPPORTED_MIME_TYPES as readonly string[]).includes(
          uploadedFile.type,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Unsupported reference file type. Allowed: PDF, plain text, Markdown.",
            code: ErrorCode.VALIDATION,
          },
          { status: 415 },
        );
      }
    }

    // Validate the relevant prompt text.
    const textToValidate = isRefinement ? refinementPrompt! : prompt;
    const promptIssue = validateUserPrompt(textToValidate);
    if (promptIssue) {
      return NextResponse.json(
        { error: promptIssue, code: ErrorCode.VALIDATION },
        { status: 400 },
      );
    }

    // Resolve client IP from trusted proxy headers (cf-connecting-ip > x-real-ip > x-forwarded-for rightmost).
    const clientIp = resolveClientIp(req);

    // Track how many security layers were bypassed (fail-open). If 2+ are
    // down simultaneously, reject the request — one service hiccup is tolerable,
    // a full cascade is not.
    let securityBypasses = 0;

    // Cloudflare Turnstile bot verification (before rate limit so bots
    // don't consume slots).
    const turnstile = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: turnstile.message, code: turnstile.code },
        { status: turnstile.httpStatus },
      );
    }
    if (turnstile.skipped) securityBypasses++;

    // Ensure the caller has a guest session (or authenticated user).
    const sessionResult = await ensureGuestSession(clientIp);
    if (!sessionResult.ok) {
      return NextResponse.json(
        { error: sessionResult.error, code: sessionResult.code },
        { status: sessionResult.httpStatus },
      );
    }
    const owner = sessionResult.owner;

    // Phase 1 RAG is authenticated users only. Guests trying to attach
    // reference material are rejected here — the UI renders a disabled
    // control with "Sign in to attach reference material" copy, but the
    // server enforces it regardless.
    if (uploadedFile && owner.type !== "user") {
      log.warn("guest attempted reference upload", {
        event: "rag.upload.guest_rejected",
        endpoint: "POST /api/generate",
        guestSessionId: owner.guestSessionId,
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
        status: 401,
      });
      void recordEvent("rag.upload.guest_rejected", {
        endpoint: "POST /api/generate",
        guestSessionId: owner.guestSessionId,
      }).catch(() => {});
      return NextResponse.json(
        {
          error: "Sign in to attach reference material.",
          code: ErrorCode.FORBIDDEN,
        },
        { status: 401 },
      );
    }

    // Block unverified email users from generating.
    if (owner.type === "user") {
      const user = await prisma.user.findUnique({
        where: { id: owner.userId },
        select: { emailVerified: true },
      });
      if (user && !user.emailVerified) {
        return NextResponse.json(
          {
            error: "Please verify your email address before generating.",
            code: ErrorCode.EMAIL_NOT_VERIFIED,
          },
          { status: 403 },
        );
      }
    }

    // Per-session/user rate limiting (sliding window).
    // Guests: 10/hr (capped at 3 total anyway). Logged-in: 20/hr.
    // BYOK (future): 60/hr — their own key, safety net only.
    let rateLimitBypassed = false;
    try {
      const rateLimitKey =
        owner.type === "guest"
          ? `generate:guest:${owner.guestSessionId}`
          : `generate:user:${owner.userId}`;
      const rateLimitMax =
        owner.type === "guest" ? RATE_LIMIT_GUEST : RATE_LIMIT_USER;
      const rl = await checkRateLimit({
        key: rateLimitKey,
        limit: rateLimitMax,
        windowSeconds: 3600,
      });
      if (!rl.allowed) {
        log.warn("generate rate limit exceeded", {
          event: "rate_limit.hit",
          endpoint: "POST /api/generate",
          ownerType: owner.type,
          ...(owner.type === "user"
            ? { userId: owner.userId }
            : { guestSessionId: owner.guestSessionId }),
          limit: rateLimitMax,
          remaining: rl.remaining,
          retryAfterSeconds: 60,
          status: 429,
        });
        const rlBucket =
          owner.type === "user" ? "generate:user" : "generate:guest";
        const rlId =
          owner.type === "user" ? owner.userId : owner.guestSessionId;
        void recordRateLimitHit(rlBucket, rlId).catch(() => {});
        void recordEvent("rate_limit.hit", {
          endpoint: "POST /api/generate",
          ownerType: owner.type,
          ...(owner.type === "user"
            ? { userId: owner.userId }
            : { guestSessionId: owner.guestSessionId }),
          limit: rateLimitMax,
        }).catch(() => {});
        return NextResponse.json(
          {
            error: "Rate limit exceeded. Try again later.",
            code: ErrorCode.RATE_LIMIT,
          },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
    } catch (err) {
      // If Redis is down, allow the request through (fail-open).
      log.warn("generate rate limit check failed, allowing", {
        event: "rate_limit.failed_open",
        endpoint: "POST /api/generate",
        ownerType: owner.type,
        ...(owner.type === "user"
          ? { userId: owner.userId }
          : { guestSessionId: owner.guestSessionId }),
        error: String(err),
      });
      rateLimitBypassed = true;
      securityBypasses++;
    }

    // Enforce generation limits (atomic operations).
    if (owner.type === "guest") {
      const gen = await consumeGuestGeneration(owner.guestSessionId);
      if (!gen.allowed) {
        log.warn("guest generation cap reached", {
          event: "generation_limit.hit",
          endpoint: "POST /api/generate",
          ownerType: "guest",
          guestSessionId: owner.guestSessionId,
          status: 403,
        });
        void recordEvent("generation_limit.hit", {
          endpoint: "POST /api/generate",
          ownerType: "guest",
          guestSessionId: owner.guestSessionId,
        }).catch(() => {});
        return NextResponse.json(
          {
            error: "You've used all your free generations. Sign up for more!",
            code: ErrorCode.GENERATION_LIMIT,
          },
          { status: 403 },
        );
      }
    } else if (owner.type === "user" && MONETIZATION_ENABLED) {
      // Atomic credit decrement: only succeeds if credits > 0.
      // Skipped when monetization is disabled — users only hit the rate limit.
      const result = await prisma.$queryRawUnsafe<{ credits: number }[]>(
        `UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits`,
        owner.userId,
      );
      if (result.length === 0) {
        log.warn("user credits exhausted", {
          event: "generation_limit.hit",
          endpoint: "POST /api/generate",
          ownerType: "user",
          userId: owner.userId,
          status: 403,
        });
        void recordEvent("generation_limit.hit", {
          endpoint: "POST /api/generate",
          ownerType: "user",
          userId: owner.userId,
        }).catch(() => {});
        return NextResponse.json(
          {
            error: "No credits remaining.",
            code: ErrorCode.GENERATION_LIMIT,
          },
          { status: 403 },
        );
      }
    }

    const lakera = await screenUserPromptWithLakera(textToValidate, {
      forwardedFor: req.headers.get("x-forwarded-for"),
    });
    if (!lakera.ok) {
      log.warn("lakera rejected prompt", {
        event: "lakera.rejected",
        endpoint: "POST /api/generate",
        ownerType: owner.type,
        ...(owner.type === "user"
          ? { userId: owner.userId }
          : { guestSessionId: owner.guestSessionId }),
        lakeraCode: lakera.code,
        status: lakera.httpStatus,
      });
      void recordEvent("lakera.rejected", {
        endpoint: "POST /api/generate",
        ownerType: owner.type,
        ...(owner.type === "user"
          ? { userId: owner.userId }
          : { guestSessionId: owner.guestSessionId }),
        lakeraCode: lakera.code,
      }).catch(() => {});
      return NextResponse.json(
        { error: lakera.message, code: lakera.code },
        { status: lakera.httpStatus },
      );
    }
    if ("skipped" in lakera && lakera.skipped) securityBypasses++;

    // Circuit breaker: if multiple security layers failed open, reject.
    if (securityBypasses >= 2) {
      log.error("multiple security layers bypassed, rejecting", {
        event: "security.cascade_rejected",
        endpoint: "POST /api/generate",
        securityBypasses,
        turnstileSkipped: !!turnstile.skipped,
        rateLimitBypassed,
        lakeraSkipped: "skipped" in lakera && !!lakera.skipped,
        status: 503,
      });
      void recordEvent("security.cascade_rejected", {
        endpoint: "POST /api/generate",
        securityBypasses,
        turnstileSkipped: !!turnstile.skipped,
        rateLimitBypassed,
        lakeraSkipped: "skipped" in lakera && !!lakera.skipped,
      }).catch(() => {});
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    let projectId: string;
    let projectName: string;
    let versionId: string;
    let versionNumber: number;

    if (isRefinement) {
      // Iterate on an existing project: look it up and create the next version.
      const existing = await prisma.project.findFirst({
        where: { id: existingProjectId, deletedAt: null },
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
          { error: "Project not found.", code: ErrorCode.VALIDATION },
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
          { error: "Forbidden.", code: ErrorCode.FORBIDDEN },
          { status: 403 },
        );
      }

      const latestVersion = existing.versions[0];
      versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

      // Atomic: update project status + create version in one transaction.
      const [, version] = await prisma.$transaction(
        async (tx) => {
          const updatedProject = await tx.project.update({
            where: { id: existing.id },
            data: { status: ProjectStatus.GENERATING },
          });
          const newVersion = await tx.version.create({
            data: {
              projectId: existing.id,
              versionNumber,
              promptDelta: refinementPrompt,
            },
          });
          return [updatedProject, newVersion] as const;
        },
        { timeout: 10000 },
      );

      projectId = existing.id;
      projectName = existing.name;
      versionId = version.id;
    } else {
      // New generation: create project + first version atomically.
      // Use a pre-generated ID so we can batch (no interactive transaction needed).
      const newProjectId = crypto.randomUUID();
      const [project, version] = await prisma.$transaction(
        async (tx) => {
          const newProject = await tx.project.create({
            data: {
              id: newProjectId,
              name: prompt,
              prompt,
              status: ProjectStatus.GENERATING,
              ...(owner.type === "guest"
                ? { guestSessionId: owner.guestSessionId }
                : {}),
              ...(owner.type === "user" ? { userId: owner.userId } : {}),
            },
          });
          const newVersion = await tx.version.create({
            data: {
              projectId: newProjectId,
              versionNumber: 1,
            },
          });
          return [newProject, newVersion] as const;
        },
        { timeout: 10000 },
      );

      projectId = project.id;
      projectName = project.name;
      versionId = version.id;
      versionNumber = 1;
    }

    // Upload reference material to R2 if present. Fail-open: an upload
    // failure logs + emits a metric but doesn't block the generation (the
    // user still gets a site, just without the RAG lift).
    let referenceFileStorageKey: string | undefined;
    let referenceFileName: string | undefined;
    let referenceContentType: string | undefined;
    let referenceFileSize: number | undefined;

    if (uploadedFile) {
      try {
        const origName = uploadedFile.name || "reference";
        const lastDot = origName.lastIndexOf(".");
        const ext = lastDot > 0 ? origName.slice(lastDot + 1).toLowerCase() : "bin";
        const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
        const safeName = `${crypto.randomUUID()}.${safeExt}`;
        const key = `projects/${projectId}/references/${safeName}`;

        const arrayBuffer = await uploadedFile.arrayBuffer();
        await uploadFile(key, Buffer.from(arrayBuffer), uploadedFile.type);

        referenceFileStorageKey = key;
        referenceFileName = origName.slice(0, 200);
        referenceContentType = uploadedFile.type;
        referenceFileSize = uploadedFile.size;

        log.info("Reference file uploaded to R2", {
          event: "rag.upload.accepted",
          projectId,
          storageKey: key,
          fileSize: uploadedFile.size,
        });
        void recordEvent("rag.upload.accepted", {
          endpoint: "POST /api/generate",
          projectId,
          fileSize: uploadedFile.size,
          contentType: uploadedFile.type,
        }).catch(() => {});
      } catch (uploadErr) {
        log.warn("Reference file R2 upload failed, proceeding without RAG", {
          event: "rag.upload.rejected",
          projectId,
          error: String(uploadErr),
        });
        void recordEvent("rag.upload.rejected", {
          endpoint: "POST /api/generate",
          projectId,
          reason: "r2_upload_failed",
        }).catch(() => {});
      }
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
        referenceFileStorageKey,
        referenceFileName,
        referenceContentType,
        referenceFileSize,
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
      // When LLM title generation is available, let the frontend show nothing
      // until the real title arrives via polling. Otherwise send the full prompt.
      projectName: TITLE_GENERATION_AVAILABLE ? null : projectName,
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
