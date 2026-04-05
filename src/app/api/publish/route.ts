import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rateLimit";
import { downloadFile, uploadFile, deleteFiles } from "@/lib/storage/r2";
import { validateSlug, generateUniqueSlug } from "@/lib/publish/slugs";
import { scrubRedirectMetaTags } from "@/lib/publish/scrub";
import { createLogger } from "@/lib/logger";
import { recordEvent, recordRateLimitHit } from "@/lib/admin/metrics";

const log = createLogger("api:publish");

/** Cap published HTML at 2 MB to keep R2 bills and proxy work bounded. */
const MAX_PUBLISHED_HTML_BYTES = 2 * 1024 * 1024;

/** Rate limit: publishes per user per hour. */
const PUBLISH_RATE_LIMIT = parseInt(
  process.env.RATE_LIMIT_PUBLISH_PER_HR ?? "5",
  10,
);

/** Build the public key for a slug. One HTML document per slug, stored at the slug root. */
function publishedKey(slug: string): string {
  return `published/${slug}/index.html`;
}

/** Build the public URL from the request's host. */
function publishedUrl(req: NextRequest, slug: string): string {
  const host = req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol.replace(":", "") || "https");
  return `${proto}://${host}/p/${slug}`;
}

/** Narrow a Prisma error to the unique-constraint case. */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * POST /api/publish
 *
 * Publish a project to a public slug, or update an existing publication
 * to point at a newer version.
 *
 * Body: { projectId: string, versionId?: string, slug?: string }
 *  - If the project is already published, the existing slug is kept and
 *    any supplied `slug` is ignored (prevents slug-swap races).
 *  - If `versionId` is omitted, the project's latest READY version is used.
 *
 * Requires an authenticated user (guests cannot publish).
 */
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req, "POST /api/publish");
  if (csrfError) return csrfError;

  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return NextResponse.json({ error: "Sign in to publish." }, { status: 401 });
  }

  // User-keyed rate limit — shared networks must not share buckets and
  // IP rotation is trivial for a motivated attacker.
  try {
    const rl = await checkRateLimit({
      key: `publish:${owner.userId}`,
      limit: PUBLISH_RATE_LIMIT,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      log.warn("publish rate limit exceeded", {
        event: "rate_limit.hit",
        userId: owner.userId,
        endpoint: "POST /api/publish",
        limit: PUBLISH_RATE_LIMIT,
        remaining: rl.remaining,
        retryAfterSeconds: 60,
        status: 429,
      });
      void recordRateLimitHit("publish", owner.userId).catch(() => {});
      void recordEvent("rate_limit.hit", {
        userId: owner.userId,
        endpoint: "POST /api/publish",
        limit: PUBLISH_RATE_LIMIT,
      }).catch(() => {});
      return NextResponse.json(
        { error: "Too many publishes. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
  } catch (err) {
    // Fail-open on Redis hiccup — publish is already behind auth + CSRF.
    log.warn("publish rate limit check failed, allowing", {
      event: "rate_limit.failed_open",
      userId: owner.userId,
      endpoint: "POST /api/publish",
      error: String(err),
    });
  }

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  const requestedVersionId =
    typeof body?.versionId === "string" ? body.versionId : null;
  const requestedSlugRaw =
    typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : null;

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required." },
      { status: 400 },
    );
  }

  // Ownership check via the repo's standard "find scoped by userId" pattern.
  // Null result covers both "not found" and "not yours" — 404 for both, no
  // enumeration leak. Pull the data we need for publishing in the same query.
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: owner.userId,
      deletedAt: null,
    },
    select: {
      id: true,
      publishedSites: {
        select: {
          id: true,
          subdomain: true,
          storageKey: true,
          versionId: true,
        },
        take: 1,
      },
      versions: {
        where: { storageKey: { not: null } },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          id: true,
          versionNumber: true,
          storageKey: true,
        },
      },
    },
  });

  if (!project) {
    log.warn("publish ownership rejected", {
      event: "auth.ownership_rejected",
      userId: owner.userId,
      endpoint: "POST /api/publish",
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Resolve the version to publish.
  let sourceVersion: {
    id: string;
    versionNumber: number;
    storageKey: string | null;
  } | null = null;

  if (requestedVersionId) {
    // Pull the specified version, still scoped to this owned project.
    sourceVersion = await prisma.version.findFirst({
      where: {
        id: requestedVersionId,
        projectId: project.id,
        storageKey: { not: null },
      },
      select: { id: true, versionNumber: true, storageKey: true },
    });
  } else {
    sourceVersion = project.versions[0] ?? null;
  }

  if (!sourceVersion?.storageKey) {
    return NextResponse.json(
      { error: "No ready version to publish." },
      { status: 409 },
    );
  }

  const existing = project.publishedSites[0] ?? null;

  // Determine the slug. Re-publish keeps the existing slug and ignores any
  // request-body slug (prevents slug-swap attempts + removes enumeration).
  // First-time publish validates a user-supplied slug or auto-generates.
  let slug: string;
  if (existing?.subdomain) {
    slug = existing.subdomain;
  } else if (requestedSlugRaw) {
    const validation = validateSlug(requestedSlugRaw);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.message ?? "Invalid URL." },
        { status: 400 },
      );
    }
    slug = requestedSlugRaw;
  } else {
    slug = await generateUniqueSlug();
  }

  // Download the draft HTML from R2, enforce the size cap, scrub, upload.
  const draftBytes = await downloadFile(sourceVersion.storageKey);
  if (!draftBytes) {
    log.error("Draft HTML missing at publish time", {
      projectId: project.id,
      versionId: sourceVersion.id,
      storageKey: sourceVersion.storageKey,
    });
    return NextResponse.json(
      { error: "Could not load the draft HTML." },
      { status: 500 },
    );
  }
  if (draftBytes.length > MAX_PUBLISHED_HTML_BYTES) {
    log.warn("publish blocked by size cap", {
      event: "publish.blocked.size",
      userId: owner.userId,
      projectId: project.id,
      bytes: draftBytes.length,
      limitBytes: MAX_PUBLISHED_HTML_BYTES,
      status: 413,
    });
    void recordEvent("publish.blocked.size", {
      userId: owner.userId,
      projectId: project.id,
      bytes: draftBytes.length,
    }).catch(() => {});
    return NextResponse.json(
      {
        error: `Published HTML exceeds the ${MAX_PUBLISHED_HTML_BYTES / 1024 / 1024} MB limit.`,
      },
      { status: 413 },
    );
  }

  const html = draftBytes.toString("utf-8");
  const scrubbed = scrubRedirectMetaTags(html);
  const destKey = publishedKey(slug);

  try {
    await uploadFile(
      destKey,
      Buffer.from(scrubbed, "utf-8"),
      "text/html; charset=utf-8",
    );
  } catch (err) {
    log.error("R2 upload failed during publish", {
      projectId: project.id,
      slug,
      error: String(err),
    });
    return NextResponse.json({ error: "Could not publish." }, { status: 500 });
  }

  // Update the existing row (re-publish) or create a new one (first publish).
  // `publishedAt` is set explicitly on both branches because the schema's
  // @default(now()) only fires on insert. The schema has no unique constraint
  // on `projectId`, so we can't use upsert — we use the `existing` row already
  // fetched in the project query.
  try {
    if (existing) {
      await prisma.publishedSite.update({
        where: { id: existing.id },
        data: {
          versionId: sourceVersion.id,
          storageKey: destKey,
          isActive: true,
          publishedAt: new Date(),
        },
      });
    } else {
      await prisma.publishedSite.create({
        data: {
          projectId: project.id,
          versionId: sourceVersion.id,
          subdomain: slug,
          storageKey: destKey,
          isActive: true,
          publishedAt: new Date(),
        },
      });
    }
  } catch (err) {
    // Best-effort rollback: remove the R2 object we just uploaded so a
    // DB failure doesn't leave an orphan. The orphaned-storage sweep
    // would eventually catch it, but we can do better inline.
    if (existing?.storageKey !== destKey) {
      await deleteFiles([destKey]).catch(() => {});
    }
    if (isUniqueConstraintError(err)) {
      log.warn("publish blocked by slug collision", {
        event: "publish.blocked.slug_taken",
        userId: owner.userId,
        projectId: project.id,
        slug,
        status: 409,
      });
      void recordEvent("publish.blocked.slug_taken", {
        userId: owner.userId,
        projectId: project.id,
        slug,
      }).catch(() => {});
      // Identical message regardless of who owns the slug — differentiation
      // would leak the active-slug namespace.
      return NextResponse.json(
        { error: "That URL is taken. Try another." },
        { status: 409 },
      );
    }
    log.error("DB upsert failed during publish", {
      projectId: project.id,
      slug,
      error: String(err),
    });
    return NextResponse.json({ error: "Could not publish." }, { status: 500 });
  }

  log.info("project published", {
    event: "publish.success",
    userId: owner.userId,
    projectId: project.id,
    slug,
    versionId: sourceVersion.id,
    versionNumber: sourceVersion.versionNumber,
    republished: !!existing,
  });

  return NextResponse.json({
    publishedUrl: publishedUrl(req, slug),
    slug,
    versionNumber: sourceVersion.versionNumber,
  });
}

/**
 * DELETE /api/publish
 *
 * Unpublish a project: deletes the PublishedSite row and the R2 object.
 * The slug is immediately freed for anyone to claim.
 *
 * Body: { projectId: string }
 */
export async function DELETE(req: NextRequest) {
  const csrfError = validateCsrf(req, "DELETE /api/publish");
  if (csrfError) return csrfError;

  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return NextResponse.json(
      { error: "Sign in to unpublish." },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required." },
      { status: 400 },
    );
  }

  // Ownership-scoped lookup; pulls the published row in the same query.
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: owner.userId,
      deletedAt: null,
    },
    select: {
      id: true,
      publishedSites: {
        select: { id: true, storageKey: true, subdomain: true },
        take: 1,
      },
    },
  });

  if (!project) {
    log.warn("unpublish ownership rejected", {
      event: "auth.ownership_rejected",
      userId: owner.userId,
      endpoint: "DELETE /api/publish",
      resourceType: "project",
      resourceId: projectId,
      status: 404,
    });
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const published = project.publishedSites[0];
  if (!published) {
    // Idempotent success — nothing to unpublish.
    return NextResponse.json({ success: true });
  }

  // DB first, then R2. If R2 fails the orphaned-storage sweep will catch it.
  await prisma.publishedSite.delete({ where: { id: published.id } });
  try {
    await deleteFiles([published.storageKey]);
  } catch (err) {
    log.warn("R2 delete failed during unpublish (will be swept)", {
      projectId: project.id,
      storageKey: published.storageKey,
      error: String(err),
    });
  }

  log.info("project unpublished", {
    event: "publish.unpublished",
    userId: owner.userId,
    projectId: project.id,
    slug: published.subdomain,
  });

  return NextResponse.json({ success: true });
}
