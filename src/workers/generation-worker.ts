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
          void job.updateProgress({ step, percent });
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
      log.error("Job failed", { error: errorMessage });

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ERROR", errorMessage },
      });
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

baseLog.info("Worker started", { queue: GENERATION_QUEUE_NAME });
