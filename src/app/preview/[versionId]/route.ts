import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { buildGeneratedHtmlHeaders } from "@/lib/security/htmlResponseHeaders";
import { createLogger } from "@/lib/logger";

const log = createLogger("preview");

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await context.params;

  const version = await prisma.version.findFirst({
    where: { id: versionId, project: { deletedAt: null } },
    select: {
      id: true,
      storageKey: true,
      project: {
        select: { guestSessionId: true, userId: true },
      },
    },
  });

  if (!version?.storageKey) {
    return NextResponse.json({ error: "Preview not ready." }, { status: 404 });
  }

  // Verify session ownership.
  const owner = await resolveOwner();
  const ownsProject =
    (owner.type === "guest" &&
      version.project?.guestSessionId === owner.guestSessionId) ||
    (owner.type === "user" && version.project?.userId === owner.userId);
  if (!ownsProject) {
    log.warn("preview ownership rejected", {
      event: "auth.ownership_rejected",
      endpoint: "GET /preview/[versionId]",
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

  const bytes = await downloadFile(version.storageKey);

  if (!bytes) {
    log.error("R2 download failed", {
      versionId,
      storageKey: version.storageKey,
    });
    return NextResponse.json(
      { error: "Could not download preview HTML." },
      { status: 404 },
    );
  }

  const html = bytes.toString("utf-8");

  return new NextResponse(html, {
    headers: buildGeneratedHtmlHeaders(),
  });
}
