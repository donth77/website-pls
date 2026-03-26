import { Worker } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { GENERATION_QUEUE_NAME } from "@/lib/queue/generationQueue";
import { createWorkerRedis } from "@/lib/queue/redis";
import { getGeneratedBucket, getSupabaseAdmin } from "@/lib/supabase/server";
import { runGenerationPipeline } from "@/lib/ai/orchestrator";

type GenerateJobData = {
  projectId: string;
  versionId: string;
  userPrompt: string;
};

const queueConnection = createWorkerRedis();
const supabase = getSupabaseAdmin();
const bucket = getGeneratedBucket();

const worker = new Worker(
  GENERATION_QUEUE_NAME,
  async (job) => {
    const data = job.data as GenerateJobData;

    const { projectId, versionId, userPrompt } = data;

    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "GENERATING" },
      });

      await job.updateProgress({ step: "Preparing…", percent: 5 });

      const { html } = await runGenerationPipeline({
        projectId,
        userPrompt,
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

      return { storageKey };
    } catch (err) {
      console.error(`Generation failed for version ${versionId}:`, err);
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ERROR" },
      });
      throw err;
    }
  },
  { connection: queueConnection },
);

worker.on("completed", (job) => {
  console.log(`Generation completed (jobId=${job.id}).`);
});

worker.on("failed", (job, err) => {
  console.error(`Generation failed (jobId=${job?.id}):`, err);
});

console.log(`Generation worker running. Queue="${GENERATION_QUEUE_NAME}"`);

