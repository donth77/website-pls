import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { buildDownloadFilename } from "@/lib/publish/filename";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:versions:export");

/**
 * GET /api/versions/[versionId]/export
 *
 * Download the generated HTML as an attachment with a sanitized filename
 * based on the project name. Server-driven so the browser handles the
 * `Content-Disposition` header natively — the client no longer needs to
 * fetch → blob → click an anchor.
 *
 * Ownership misses return 404 (never 403) so the endpoint doesn't leak
 * whether a versionId exists in someone else's account.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const owner = await resolveOwner();
  if (owner.type === "anonymous") {
    // Anonymous callers can't own a version — return 404 to match the
    // "not found or not yours" posture.
    return new NextResponse("Not found.", { status: 404 });
  }

  // Ownership-scoped lookup. Null result (not found OR not yours) is 404
  // for both cases — no enumeration leak.
  const version = await prisma.version.findFirst({
    where: {
      id: versionId,
      storageKey: { not: null },
      project: {
        deletedAt: null,
        ...(owner.type === "user"
          ? { userId: owner.userId }
          : { guestSessionId: owner.guestSessionId }),
      },
    },
    select: {
      id: true,
      storageKey: true,
      project: {
        select: { name: true },
      },
    },
  });

  if (!version?.storageKey) {
    log.warn("export ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "GET /api/versions/[versionId]/export",
      ...(owner.type === "user"
        ? { userId: owner.userId }
        : { guestSessionId: owner.guestSessionId }),
      resourceType: "version",
      resourceId: versionId,
      status: 404,
    });
    return new NextResponse("Not found.", { status: 404 });
  }

  const bytes = await downloadFile(version.storageKey);
  if (!bytes) {
    log.error("R2 download failed for export", {
      versionId,
      storageKey: version.storageKey,
    });
    return new NextResponse("Not found.", { status: 404 });
  }

  // Sanitized filename — the only characters that can reach the header are
  // [a-z0-9-], so header injection is impossible by construction.
  const filename = `${buildDownloadFilename(version.project?.name)}.html`;

  return new NextResponse(bytes.toString("utf-8"), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
