import { prisma } from "@/lib/db/prisma";
import { listFiles, deleteFiles } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";

const log = createLogger("cleanup:orphaned-storage");

/**
 * Reconciliation sweep for R2 objects whose owning DB rows no longer exist.
 *
 * Why this exists: the admin delete flow is best-effort about R2 cleanup —
 * it proceeds with the DB delete even if `deleteFiles` fails, because a
 * half-deleted DB state is worse than a few orphaned blobs. This function
 * catches those orphans (and any left behind by crashes or network errors).
 *
 * Safe to run regularly — it only deletes R2 objects whose project/user ID
 * is NOT present in the database. A freshly-created project that hasn't
 * been persisted to the DB yet is not reachable by this function because
 * the worker writes the DB row before uploading to R2.
 */
export async function purgeOrphanedR2Objects(): Promise<{
  projectsScanned: number;
  projectFilesRemoved: number;
  avatarsScanned: number;
  avatarsRemoved: number;
  publishedScanned: number;
  publishedFilesRemoved: number;
}> {
  log.info("Starting orphaned R2 object sweep");

  // -------------------------------------------------------------------------
  // Projects: keys look like `projects/{projectId}/...`
  // -------------------------------------------------------------------------
  const projectKeys = await listFiles("projects/");

  // Group keys by projectId (second path segment).
  const keysByProjectId = new Map<string, string[]>();
  for (const key of projectKeys) {
    const segments = key.split("/");
    if (segments.length < 2 || segments[0] !== "projects") continue;
    const projectId = segments[1];
    if (!projectId) continue;
    const existing = keysByProjectId.get(projectId);
    if (existing) {
      existing.push(key);
    } else {
      keysByProjectId.set(projectId, [key]);
    }
  }

  const projectIds = Array.from(keysByProjectId.keys());

  let projectFilesRemoved = 0;
  if (projectIds.length > 0) {
    // Check which of those IDs still exist in the DB.
    const existing = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((p) => p.id));

    const orphanKeys: string[] = [];
    for (const [projectId, keys] of keysByProjectId.entries()) {
      if (!existingIds.has(projectId)) {
        orphanKeys.push(...keys);
      }
    }

    if (orphanKeys.length > 0) {
      log.warn("Found orphaned project files", {
        orphanProjectCount: projectIds.length - existingIds.size,
        orphanFileCount: orphanKeys.length,
      });
      await deleteFiles(orphanKeys);
      projectFilesRemoved = orphanKeys.length;
    }
  }

  // -------------------------------------------------------------------------
  // Avatars: keys look like `avatars/{userId}.{ext}`
  // -------------------------------------------------------------------------
  const avatarKeys = await listFiles("avatars/");

  const keysByUserId = new Map<string, string[]>();
  for (const key of avatarKeys) {
    const filename = key.split("/")[1];
    if (!filename) continue;
    const dotIndex = filename.lastIndexOf(".");
    const userId = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
    if (!userId) continue;
    const existing = keysByUserId.get(userId);
    if (existing) {
      existing.push(key);
    } else {
      keysByUserId.set(userId, [key]);
    }
  }

  const userIds = Array.from(keysByUserId.keys());

  let avatarsRemoved = 0;
  if (userIds.length > 0) {
    const existing = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((u) => u.id));

    const orphanKeys: string[] = [];
    for (const [userId, keys] of keysByUserId.entries()) {
      if (!existingIds.has(userId)) {
        orphanKeys.push(...keys);
      }
    }

    if (orphanKeys.length > 0) {
      log.warn("Found orphaned avatars", {
        orphanUserCount: userIds.length - existingIds.size,
        orphanFileCount: orphanKeys.length,
      });
      await deleteFiles(orphanKeys);
      avatarsRemoved = orphanKeys.length;
    }
  }

  // -------------------------------------------------------------------------
  // Published sites: keys look like `published/{slug}/index.html`
  // -------------------------------------------------------------------------
  const publishedKeys = await listFiles("published/");

  // Group keys by slug (second path segment). A single slug usually only has
  // `index.html`, but we group defensively in case future features add more.
  const keysBySlug = new Map<string, string[]>();
  for (const key of publishedKeys) {
    const segments = key.split("/");
    if (segments.length < 2 || segments[0] !== "published") continue;
    const slug = segments[1];
    if (!slug) continue;
    const existing = keysBySlug.get(slug);
    if (existing) {
      existing.push(key);
    } else {
      keysBySlug.set(slug, [key]);
    }
  }

  const slugs = Array.from(keysBySlug.keys());

  let publishedFilesRemoved = 0;
  if (slugs.length > 0) {
    // Check which of those slugs still have an active PublishedSite row.
    // Inactive rows (isActive=false) count as orphans — their object should
    // have been deleted on unpublish. Same for rows attached to soft-deleted
    // projects (cascade removes the PublishedSite, so the slug won't appear
    // in this lookup at all).
    const existing = await prisma.publishedSite.findMany({
      where: { subdomain: { in: slugs }, isActive: true },
      select: { subdomain: true },
    });
    const existingSlugs = new Set(
      existing.map((p) => p.subdomain).filter((s): s is string => !!s),
    );

    const orphanKeys: string[] = [];
    for (const [slug, keys] of keysBySlug.entries()) {
      if (!existingSlugs.has(slug)) {
        orphanKeys.push(...keys);
      }
    }

    if (orphanKeys.length > 0) {
      log.warn("Found orphaned published sites", {
        orphanSlugCount: slugs.length - existingSlugs.size,
        orphanFileCount: orphanKeys.length,
      });
      await deleteFiles(orphanKeys);
      publishedFilesRemoved = orphanKeys.length;
    }
  }

  const result = {
    projectsScanned: projectIds.length,
    projectFilesRemoved,
    avatarsScanned: userIds.length,
    avatarsRemoved,
    publishedScanned: slugs.length,
    publishedFilesRemoved,
  };
  log.info("Orphaned R2 sweep complete", result);
  return result;
}
