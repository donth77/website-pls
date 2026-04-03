import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { getSupabaseAdmin, getGeneratedBucket } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:projects");

const MAX_PROJECT_NAME_LEN = 100;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const owner = await resolveOwner();

  if (owner.type === "anonymous") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : null;

  if (!name || name.length === 0) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  if (name.length > MAX_PROJECT_NAME_LEN) {
    return NextResponse.json(
      { error: `Name must be ${MAX_PROJECT_NAME_LEN} characters or less.` },
      { status: 400 },
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, guestSessionId: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const ownsProject =
    (owner.type === "user" && project.userId === owner.userId) ||
    (owner.type === "guest" && project.guestSessionId === owner.guestSessionId);

  if (!ownsProject) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { name },
  });

  log.info("Project renamed", { projectId, name });

  return NextResponse.json({ success: true, name });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const owner = await resolveOwner();

  if (owner.type === "anonymous") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      guestSessionId: true,
      status: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Verify ownership
  const ownsProject =
    (owner.type === "user" && project.userId === owner.userId) ||
    (owner.type === "guest" && project.guestSessionId === owner.guestSessionId);

  if (!ownsProject) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (project.status === "GENERATING") {
    return NextResponse.json(
      { error: "Cannot delete a project while it is generating." },
      { status: 409 },
    );
  }

  // Clean up Supabase storage (best-effort — DB delete proceeds even if this fails)
  try {
    const supabase = getSupabaseAdmin();
    const bucket = getGeneratedBucket();
    const prefix = `projects/${projectId}/`;

    const { data: files } = await supabase.storage
      .from(bucket)
      .list(prefix.slice(0, -1));

    if (files && files.length > 0) {
      const allPaths: string[] = [];
      for (const file of files) {
        if (file.id) {
          allPaths.push(`${prefix}${file.name}`);
        } else {
          // Subdirectory — list its contents
          const { data: subFiles } = await supabase.storage
            .from(bucket)
            .list(`${prefix}${file.name}`);
          if (subFiles) {
            for (const sub of subFiles) {
              allPaths.push(`${prefix}${file.name}/${sub.name}`);
            }
          }
        }
      }

      if (allPaths.length > 0) {
        await supabase.storage.from(bucket).remove(allPaths);
        log.info("Removed storage files", {
          projectId,
          fileCount: allPaths.length,
        });
      }
    }
    // TODO: If publish feature is implemented, also sweep `published/` storage keys.
  } catch (err) {
    log.warn("Supabase storage cleanup failed — proceeding with DB delete", {
      projectId,
      error: String(err),
    });
  }

  // Cascade deletes versions (and publishedSites) via Prisma schema
  await prisma.project.delete({ where: { id: projectId } });

  log.info("Project deleted", { projectId, ownerType: owner.type });

  return NextResponse.json({ success: true });
}
