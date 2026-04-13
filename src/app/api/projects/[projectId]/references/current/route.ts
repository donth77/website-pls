import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";
import { validateCsrf } from "@/lib/csrf";
import { recordEvent } from "@/lib/admin/metrics";
import { deleteFiles } from "@/lib/storage/r2";

const log = createLogger("api:references");

/**
 * DELETE /api/projects/[projectId]/references/current
 *
 * Remove the active reference document for a project. Cascade-deletes the
 * associated ReferenceChunk rows via the schema relation, then deletes the
 * underlying R2 object.
 *
 * Phase 1 is authenticated-user only — guests cannot attach reference
 * material and therefore cannot delete one either. Returns 401 for
 * anonymous callers, 404 for not-found / not-yours (ownership-scoped
 * lookup, same shape as the rest of the project routes), and 409 if the
 * project is mid-generation (deleting a document the current worker is
 * about to read would race with ingestion).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const csrfError = validateCsrf(
    req,
    "DELETE /api/projects/[projectId]/references/current",
  );
  if (csrfError) return csrfError;

  const { projectId } = await params;
  const owner = await resolveOwner();

  if (owner.type !== "user") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      userId: owner.userId,
    },
    select: { id: true, status: true },
  });

  if (!project) {
    log.warn("reference delete ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "DELETE /api/projects/[projectId]/references/current",
      userId: owner.userId,
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (project.status === "GENERATING") {
    return NextResponse.json(
      {
        error:
          "Cannot remove reference material while the project is generating.",
      },
      { status: 409 },
    );
  }

  const doc = await prisma.referenceDocument.findFirst({
    where: { projectId },
    select: { id: true, storageKey: true },
    orderBy: { createdAt: "desc" },
  });

  if (!doc) {
    // Idempotent: no document = nothing to delete, still return success.
    return NextResponse.json({ success: true });
  }

  // Cascade-deletes chunks via the schema relation.
  await prisma.referenceDocument.delete({ where: { id: doc.id } });

  // Best-effort R2 cleanup. Even if this fails, the DB rows are gone, so
  // retrieval stops working for that document — the R2 object becomes an
  // orphan that the periodic cleanup job can reap later.
  try {
    await deleteFiles([doc.storageKey]);
  } catch (err) {
    log.warn("reference R2 delete failed (orphaned object)", {
      projectId,
      storageKey: doc.storageKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("Reference document removed", {
    event: "rag.library.document_removed",
    projectId,
    referenceDocumentId: doc.id,
    userId: owner.userId,
  });
  void recordEvent("rag.library.document_removed", {
    projectId,
    referenceDocumentId: doc.id,
    userId: owner.userId,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
