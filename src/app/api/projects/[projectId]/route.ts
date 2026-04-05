import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";
import { validateCsrf } from "@/lib/csrf";

const log = createLogger("api:projects");

const MAX_PROJECT_NAME_LEN = 100;

/**
 * GET /api/projects/[projectId]
 *
 * Fetch project metadata including any active published site. Used by the
 * generator UI to render the publish button in the correct state.
 *
 * Ownership-scoped lookup: returns 404 for both "not found" and "not yours"
 * so the endpoint doesn't leak project existence across accounts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const owner = await resolveOwner();

  if (owner.type === "anonymous") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
    },
    select: {
      id: true,
      name: true,
      status: true,
      publishedSites: {
        where: { isActive: true },
        select: {
          subdomain: true,
          versionId: true,
          publishedAt: true,
          version: { select: { versionNumber: true } },
        },
        take: 1,
      },
    },
  });

  if (!project) {
    log.warn("projects ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "GET /api/projects/[projectId]",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const published = project.publishedSites[0];
  const host = _req.headers.get("host");
  const proto =
    _req.headers.get("x-forwarded-proto") ??
    (_req.nextUrl.protocol.replace(":", "") || "https");

  return NextResponse.json({
    id: project.id,
    name: project.name,
    status: project.status,
    publishedSite:
      published?.subdomain && published.version
        ? {
            slug: published.subdomain,
            publishedUrl: `${proto}://${host}/p/${published.subdomain}`,
            publishedVersionNumber: published.version.versionNumber,
          }
        : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const csrfError = validateCsrf(req, "PATCH /api/projects/[projectId]");
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
    log.warn("projects ownership rejected", {
      event: "auth.ownership_rejected",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "project",
      resourceId: projectId,
      status: 403,
    });
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
  const csrfError = validateCsrf(req, "DELETE /api/projects/[projectId]");
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
    log.warn("projects ownership rejected", {
      event: "auth.ownership_rejected",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "project",
      resourceId: projectId,
      status: 403,
    });
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
