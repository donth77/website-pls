import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getGenerationQueue } from "@/lib/queue/generationQueue";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:versions");

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const version = await prisma.version.findFirst({
    where: { id: versionId, project: { deletedAt: null } },
    include: {
      project: {
        select: {
          name: true,
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
    log.warn("version poll ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "GET /api/versions/[versionId]",
      ownerType: owner.type,
      ...(owner.type === "user" ? { userId: owner.userId } : {}),
      ...(owner.type === "guest"
        ? { guestSessionId: owner.guestSessionId }
        : {}),
      resourceType: "version",
      resourceId: versionId,
      status: 403,
    });
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const projectStatus = version.project?.status ?? "DRAFT";

  let step: string | null = null;
  let percent: number | null = null;
  let commentary: string | null = null;

  // Read job data for both GENERATING (progress) and READY (commentary).
  if (projectStatus === "GENERATING" || projectStatus === "READY") {
    try {
      const queue = getGenerationQueue();
      const job = await queue.getJob(versionId);
      const prog = job?.progress as
        | { step?: string; percent?: number; commentary?: string }
        | undefined;
      if (prog) {
        step = prog.step ?? null;
        percent = prog.percent ?? null;
        commentary = prog.commentary ?? null;
      }
      // Fallback: check job return value for completed jobs
      if (!commentary && job?.returnvalue?.commentary) {
        commentary = job.returnvalue.commentary as string;
      }
    } catch {
      // Best-effort — if Redis is slow the poll still returns status
    }
  }

  return NextResponse.json({
    versionId: version.id,
    projectId: version.projectId,
    projectName: version.project?.name ?? null,
    projectStatus,
    step,
    percent,
    commentary,
  });
}
