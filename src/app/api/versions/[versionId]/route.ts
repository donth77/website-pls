import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGenerationQueue } from "@/lib/queue/generationQueue";
import { resolveOwner } from "@/lib/auth/resolveOwner";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: {
      project: {
        select: {
          status: true,
          guestSessionId: true,
          userId: true,
        },
      },
    },
  });

  if (!version) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Verify session ownership.
  const owner = await resolveOwner();
  const ownsProject =
    (owner.type === "guest" &&
      version.project?.guestSessionId === owner.guestSessionId) ||
    (owner.type === "user" && version.project?.userId === owner.userId);
  if (!ownsProject) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
