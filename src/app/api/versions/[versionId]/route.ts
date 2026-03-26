import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGenerationQueue } from "@/lib/queue/generationQueue";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: { project: true },
  });

  if (!version) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const projectStatus = version.project?.status ?? "DRAFT";

  let step: string | null = null;
  let percent: number | null = null;

  if (projectStatus === "GENERATING") {
    try {
      const queue = getGenerationQueue();
      const job = await queue.getJob(versionId);
      const prog = job?.progress as
        | { step?: string; percent?: number }
        | undefined;
      if (prog) {
        step = prog.step ?? null;
        percent = prog.percent ?? null;
      }
    } catch {
      // Best-effort — if Redis is slow the poll still returns status
    }
  }

  return NextResponse.json({
    versionId: version.id,
    projectId: version.projectId,
    projectStatus,
    step,
    percent,
  });
}

