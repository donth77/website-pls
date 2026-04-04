import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { createLogger } from "@/lib/logger";

const iframeWhitelist = readFileSync(
  join(process.cwd(), "src/lib/iframe-whitelist.txt"),
  "utf-8",
)
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .join(" ");

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
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Helps third-party image CDNs (e.g. Wikimedia) receive a normal Referer from subresources.
      "referrer-policy": "strict-origin-when-cross-origin",
      // CSP: allow Tailwind CDN script + inline styles (Tailwind JIT) + stock photo CDNs.
      // Block all other scripts (mitigates LLM-injected <script>/event handlers).
      "content-security-policy": [
        "default-src 'none'",
        "script-src https://cdn.tailwindcss.com",
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' https: data:",
        `frame-src ${iframeWhitelist}`,
        "connect-src 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}
