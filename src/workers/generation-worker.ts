import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { GENERATION_QUEUE_NAME } from "@/lib/queue/generationQueue";
import { createWorkerRedis } from "@/lib/queue/redis";
import { uploadFile, downloadFile } from "@/lib/storage/r2";
import { runGenerationPipeline } from "@/lib/ai/orchestrator";

type GenerateJobData = {
  projectId: string;
  versionId: string;
  userPrompt: string;
  refinementPrompt?: string;
  requestId?: string;
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
    const { projectId, versionId, userPrompt, refinementPrompt, requestId } =
      data;
    const log = baseLog.child({
      requestId,
      projectId,
      versionId,
      jobId: job.id,
    });

    log.info("Job started", { isRefinement: !!refinementPrompt });

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
          log.info("Job completed", { storageKey });
          return { storageKey, commentary };
        })(),
      ]);
    } catch (err) {
      const errorMessage = (
        err instanceof Error ? err.message : String(err)
      ).slice(0, 1000);
      const isFinalAttempt = job.attemptsMade >= (job.opts?.attempts ?? 1) - 1;

      log.error("Job failed", {
        error: errorMessage,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts?.attempts ?? 1,
        isFinalAttempt,
      });

      if (isFinalAttempt) {
        // Only mark ERROR and refund on the last attempt — earlier attempts
        // will be retried by BullMQ and the project stays GENERATING.
        await prisma.project.update({
          where: { id: projectId },
          data: { status: "ERROR", errorMessage },
        });

        try {
          const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { userId: true, guestSessionId: true },
          });
          if (project?.userId && process.env.ENABLE_MONETIZATION === "true") {
            await prisma.user.update({
              where: { id: project.userId },
              data: { credits: { increment: 1 } },
            });
            log.info("Refunded credit to user", { userId: project.userId });
          } else if (project?.guestSessionId) {
            await prisma.$queryRawUnsafe(
              `UPDATE guest_sessions SET generations_used = GREATEST(generations_used - 1, 0) WHERE id = $1`,
              project.guestSessionId,
            );
            log.info("Refunded generation to guest", {
              guestSessionId: project.guestSessionId,
            });
          }
        } catch (refundErr) {
          log.warn("Credit refund failed", { error: String(refundErr) });
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
