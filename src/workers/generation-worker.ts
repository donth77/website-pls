import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { GENERATION_QUEUE_NAME } from "@/lib/queue/generationQueue";
import { createWorkerRedis } from "@/lib/queue/redis";
import { uploadFile, downloadFile } from "@/lib/storage/r2";
import { runGenerationPipeline } from "@/lib/ai/orchestrator";
import { ingestDocument } from "@/lib/rag/ingest";
import { ErrorCode } from "@/lib/types";

type GenerateJobData = {
  projectId: string;
  versionId: string;
  userPrompt: string;
  refinementPrompt?: string;
  requestId?: string;
  referenceFileStorageKey?: string;
  referenceFileName?: string;
  referenceContentType?: string;
  referenceFileSize?: number;
  /** BYOK Anthropic key. Scrubbed from job data on completion. */
  userApiKey?: string;
  /** BYOK-only model override (full Anthropic ID, already allowlist-resolved). */
  userModel?: string;
};

const baseLog = createLogger("worker");
const queueConnection = createWorkerRedis();

const JOB_TIMEOUT_MS = 300_000; // 5 minutes — matches lockDuration

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const TITLE_MODEL =
  process.env.TITLE_GENERATION_MODEL ?? "google/gemini-2.5-flash-lite";

/**
 * Generate a short project title from the user's prompt via OpenRouter (Gemini Flash-Lite).
 * Best-effort — returns null on failure so it never blocks the job.
 */
async function generateProjectTitle(prompt: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(OPENROUTER_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TITLE_MODEL,
        max_tokens: 20,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Output ONLY a short project title (3-6 words) for a website based on the user's description. No quotes, no punctuation, no explanation.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

const worker = new Worker(
  GENERATION_QUEUE_NAME,
  async (job) => {
    const data = job.data as GenerateJobData;
    const {
      projectId,
      versionId,
      userPrompt,
      refinementPrompt,
      requestId,
      referenceFileStorageKey,
      referenceFileName,
      referenceContentType,
      referenceFileSize,
      userApiKey,
      userModel,
    } = data;
    const log = baseLog.child({
      requestId,
      projectId,
      versionId,
      jobId: job.id,
    });

    log.info("Job started", {
      isRefinement: !!refinementPrompt,
      hasReferenceFile: !!referenceFileStorageKey,
      byok: !!userApiKey,
    });

    // Hard timeout — rejects if the job exceeds JOB_TIMEOUT_MS.
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Job timed out after 5 minutes")),
        JOB_TIMEOUT_MS,
      );
    });

    try {
      return await Promise.race([
        timeoutPromise,
        (async () => {
          await prisma.project.update({
            where: { id: projectId },
            data: { status: "GENERATING" },
          });

          await job.updateProgress({ step: "Preparing…", percent: 5 });

          // Fire title generation early (in parallel with the pipeline) so
          // the polling endpoint picks it up sooner.
          const titlePromise = !refinementPrompt
            ? generateProjectTitle(userPrompt).then(async (title) => {
                if (title) {
                  await prisma.project.update({
                    where: { id: projectId },
                    data: { name: title },
                  });
                  log.info("Project title set", { projectTitle: title });
                }
                return title;
              })
            : Promise.resolve(null);

          // Ingest reference material if the API route uploaded one. Fail-open:
          // errors are logged but don't stop the generation, because users
          // still get a site (just without the RAG lift).
          if (
            referenceFileStorageKey &&
            referenceFileName &&
            referenceContentType &&
            typeof referenceFileSize === "number"
          ) {
            await job.updateProgress({
              step: "Reading your document…",
              percent: 10,
            });
            try {
              await ingestDocument({
                projectId,
                storageKey: referenceFileStorageKey,
                meta: {
                  fileName: referenceFileName,
                  contentType: referenceContentType,
                  fileSize: referenceFileSize,
                },
                requestId,
              });
            } catch (ingestErr) {
              log.warn(
                "Reference document ingestion failed, proceeding without RAG",
                {
                  error:
                    ingestErr instanceof Error
                      ? ingestErr.message
                      : String(ingestErr),
                },
              );
            }
          }

          // For refinements, fetch the previous version's HTML from R2.
          let previousHtml: string | undefined;
          if (refinementPrompt) {
            const prevVersion = await prisma.version.findFirst({
              where: { projectId, NOT: { id: versionId } },
              orderBy: { versionNumber: "desc" },
              select: { storageKey: true },
            });
            if (prevVersion?.storageKey) {
              const blob = await downloadFile(prevVersion.storageKey);
              if (blob) {
                previousHtml = blob.toString("utf-8");
              }
            }
          }

          const { html, commentary } = await runGenerationPipeline({
            projectId,
            userPrompt,
            previousHtml,
            refinementPrompt,
            requestId,
            apiKey: userApiKey,
            model: userModel,
            onProgress: (step, percent) => {
              job.updateProgress({ step, percent }).catch((e) => {
                log.warn("Progress update failed", { error: String(e) });
              });
            },
          });

          await job.updateProgress({ step: "Uploading…", percent: 95 });

          const storageKey = `projects/${projectId}/versions/${versionId}/index.html`;

          await uploadFile(
            storageKey,
            Buffer.from(html, "utf-8"),
            "text/html; charset=utf-8",
          );

          await prisma.version.update({
            where: { id: versionId },
            data: { storageKey, commentary },
          });

          // Ensure the early title generation has settled before marking READY.
          await titlePromise;

          // Store commentary in progress so the polling endpoint can return it
          // alongside the READY status.
          await job.updateProgress({
            step: "complete",
            percent: 100,
            ...(commentary ? { commentary } : {}),
          });

          await prisma.project.update({
            where: { id: projectId },
            data: { status: "READY" },
          });

          // Scrub the BYOK key from Redis. removeOnComplete keeps the last
          // 100 jobs around for debugging; the key must not be one of the
          // fields preserved there.
          if (userApiKey) {
            try {
              await job.updateData({ ...data, userApiKey: undefined });
            } catch (scrubErr) {
              log.warn("Failed to scrub BYOK key from job data", {
                error: String(scrubErr),
              });
            }
          }

          log.info("Job completed", { storageKey });
          return { storageKey, commentary };
        })(),
      ]);
    } catch (err) {
      const errorMessage = (
        err instanceof Error ? err.message : String(err)
      ).slice(0, 1000);

      // Anthropic 429 on a platform-key run = we're out of credits/rate.
      // BYOK 429 is the user's own quota, surface as a normal failure.
      // Either way, retrying in 5s won't help — discard so BullMQ doesn't
      // burn another slot.
      const status = (err as { status?: number })?.status;
      const isPlatformBudgetLow = status === 429 && !userApiKey;
      if (status === 429) {
        try {
          await job.discard();
        } catch {
          /* best-effort */
        }
      }

      const isFinalAttempt =
        status === 429 ||
        job.attemptsMade >= (job.opts?.attempts ?? 1) - 1;

      log.error("Job failed", {
        error: errorMessage,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts?.attempts ?? 1,
        isFinalAttempt,
        anthropicStatus: status,
        platformBudgetLow: isPlatformBudgetLow,
      });

      // Make the error code observable to the poll endpoint.
      if (isPlatformBudgetLow) {
        try {
          await job.updateProgress({
            step: "error",
            percent: 100,
            errorCode: ErrorCode.PLATFORM_BUDGET_LOW,
          });
        } catch {
          /* best-effort */
        }
      }

      if (isFinalAttempt) {
        // Only mark ERROR and refund on the last attempt — earlier attempts
        // will be retried by BullMQ and the project stays GENERATING.
        await prisma.project.update({
          where: { id: projectId },
          data: { status: "ERROR", errorMessage },
        });

        // BYOK runs never consumed a guest generation or user credit
        // (see /api/generate), so there's nothing to refund there.
        if (!userApiKey) {
          try {
            const project = await prisma.project.findUnique({
              where: { id: projectId },
              select: { userId: true, guestSessionId: true },
            });
            if (
              project?.userId &&
              process.env.ENABLE_MONETIZATION === "true"
            ) {
              await prisma.user.update({
                where: { id: project.userId },
                data: { credits: { increment: 1 } },
              });
              log.info("Refunded credit to user", { userId: project.userId });
            } else if (project?.guestSessionId) {
              await prisma.$executeRaw`
                UPDATE guest_sessions
                SET generations_used = GREATEST(generations_used - 1, 0)
                WHERE id = ${project.guestSessionId}
              `;
              log.info("Refunded generation to guest", {
                guestSessionId: project.guestSessionId,
              });
            }
          } catch (refundErr) {
            log.warn("Credit refund failed", { error: String(refundErr) });
          }
        }
      }

      // Scrub the BYOK key on failure too — removeOnFail keeps the last 50
      // failed jobs for debugging, and we don't want the key sitting there.
      if (userApiKey) {
        try {
          await job.updateData({ ...data, userApiKey: undefined });
        } catch {
          /* best-effort */
        }
      }

      throw err;
    }
  },
  {
    connection: queueConnection,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  },
);

worker.on("completed", (job) => {
  baseLog.info("Job completed event", { jobId: job.id });
});

worker.on("failed", (job, err) => {
  baseLog.error("Job failed event", { jobId: job?.id, error: err.message });
});

// Graceful shutdown: finish the current job before exiting.
async function shutdown(signal: string) {
  baseLog.info(`${signal} received, shutting down worker…`);
  await worker.close();
  baseLog.info("Worker stopped");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

baseLog.info("Worker started", { queue: GENERATION_QUEUE_NAME });
