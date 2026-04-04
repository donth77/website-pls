import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";
import { validateCsrf } from "@/lib/csrf";

const log = createLogger("api:projects");

const MAX_PROJECT_NAME_LEN = 100;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

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

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
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
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { projectId } = await params;
  const owner = await resolveOwner();

  if (owner.type === "anonymous") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
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

  // Soft-delete: mark as deleted, defer storage cleanup to the purge job.
  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });

  log.info("Project soft-deleted", { projectId, ownerType: owner.type });

  return NextResponse.json({ success: true });
}
