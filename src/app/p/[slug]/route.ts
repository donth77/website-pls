import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { downloadFile } from "@/lib/storage/r2";
import { buildGeneratedHtmlHeaders } from "@/lib/security/htmlResponseHeaders";
import { createLogger } from "@/lib/logger";

const log = createLogger("publish:proxy");

/**
 * Cache-Control for published sites.
 *
 *   - max-age=300           : browser caches for 5 minutes
 *   - s-maxage=300          : shared caches (CDN) cache for 5 minutes
 *   - stale-while-revalidate: CDN serves stale for up to 1 hour while fetching
 *                             a fresh copy in the background, so no visitor
 *                             pays the revalidation cost on the critical path
 *
 * Combined with the ETag below, a viral published page hits origin roughly
 * once per CDN region per 5 minutes. See the publish plan for the full
 * deployment posture (Railway + Cloudflare).
 */
const PUBLIC_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";

/**
 * GET /p/[slug]
 *
 * Public proxy for a published site. Fetches the HTML from R2 and serves it
 * through the same CSP the preview route uses — the R2 bucket stays private,
 * and all traffic passes through this handler so the security headers cover
 * published sites identically to previews.
 *
 * Not wrapped in the `[locale]` segment — published sites are not localized.
 * The middleware matcher excludes `/p/` so `next-intl` doesn't interfere.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  const published = await prisma.publishedSite.findFirst({
    where: {
      subdomain: slug,
      isActive: true,
      project: { deletedAt: null },
    },
    select: {
      storageKey: true,
      versionId: true,
    },
  });

  if (!published) {
    return new NextResponse("Not found.", { status: 404 });
  }

  // ETag short-circuit: if the client already has the current version
  // cached, return 304 without touching R2. The ETag is derived from the
  // versionId, so republishing invalidates it automatically.
  const etag = `"v-${published.versionId ?? "unknown"}"`;
  const ifNoneMatch = _req.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": PUBLIC_CACHE_CONTROL,
        Vary: "Accept-Encoding",
      },
    });
  }

  const bytes = await downloadFile(published.storageKey);
  if (!bytes) {
    log.error("R2 download failed for published site", {
      slug,
      storageKey: published.storageKey,
    });
    return new NextResponse("Not found.", { status: 404 });
  }

  const headers = buildGeneratedHtmlHeaders({
    cacheControl: PUBLIC_CACHE_CONTROL,
  });

  return new NextResponse(bytes.toString("utf-8"), {
    headers: {
      ...headers,
      ETag: etag,
      Vary: "Accept-Encoding",
    },
  });
}
