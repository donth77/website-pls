import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";
import { validateCsrf } from "@/lib/csrf";
import { resolvePublicOrigin } from "@/lib/http/publicUrl";

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
      referenceDocuments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          contentType: true,
          status: true,
          tokenCount: true,
          embeddingProvider: true,
          createdAt: true,
        },
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
  const origin = resolvePublicOrigin(_req.headers);

  const referenceDoc = project.referenceDocuments[0] ?? null;

  return NextResponse.json({
    id: project.id,
    name: project.name,
    status: project.status,
    publishedSite:
      published?.subdomain && published.version
        ? {
            slug: published.subdomain,
            publishedUrl: `${origin}/p/${published.subdomain}`,
            publishedVersionNumber: published.version.versionNumber,
          }
        : null,
    referenceDocument: referenceDoc
      ? {
          id: referenceDoc.id,
          fileName: referenceDoc.fileName,
          fileSize: referenceDoc.fileSize,
          contentType: referenceDoc.contentType,
          status: referenceDoc.status,
          tokenCount: referenceDoc.tokenCount,
          embeddingProvider: referenceDoc.embeddingProvider,
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

  const updated = await prisma.project.updateMany({
    where: {
      id: projectId,
      deletedAt: null,
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
    },
    data: { name },
  });

  if (updated.count === 0) {
    log.warn("projects ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "PATCH /api/projects/[projectId]",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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
    where: {
      id: projectId,
      deletedAt: null,
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
    },
    select: { id: true, status: true },
  });

  if (!project) {
    log.warn("projects ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "DELETE /api/projects/[projectId]",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
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
