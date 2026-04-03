import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import { GENERATION_QUEUE_NAME } from "@/lib/queue/generationQueue";
import { createWorkerRedis } from "@/lib/queue/redis";
import { getGeneratedBucket, getSupabaseAdmin } from "@/lib/supabase/server";
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
const supabase = getSupabaseAdmin();
const bucket = getGeneratedBucket();

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

    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "GENERATING" },
      });

      await job.updateProgress({ step: "Preparing…", percent: 5 });

      // For refinements, fetch the previous version's HTML from Supabase.
      let previousHtml: string | undefined;
      if (refinementPrompt) {
        const prevVersion = await prisma.version.findFirst({
          where: { projectId, NOT: { id: versionId } },
          orderBy: { versionNumber: "desc" },
          select: { storageKey: true },
        });
        if (prevVersion?.storageKey) {
          const { data: blob } = await supabase.storage
            .from(bucket)
            .download(prevVersion.storageKey);
          if (blob) {
            previousHtml = Buffer.from(await blob.arrayBuffer()).toString(
              "utf-8",
            );
          }
        }
      }

      const { html } = await runGenerationPipeline({
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

      const upload = await supabase.storage
        .from(bucket)
        .upload(storageKey, Buffer.from(html, "utf-8"), {
          contentType: "text/html; charset=utf-8",
          upsert: true,
        });

      if (upload.error) {
        throw upload.error;
      }

      await prisma.version.update({
        where: { id: versionId },
        data: { storageKey },
      });

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "READY" },
      });

      log.info("Job completed", { storageKey });
      return { storageKey };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
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
          if (project?.userId) {
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
