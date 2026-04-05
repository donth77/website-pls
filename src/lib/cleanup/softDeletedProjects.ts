import { prisma } from "@/lib/db/prisma";
import { listFiles, deleteFiles } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";

const log = createLogger("cleanup:soft-delete");

const DEFAULT_RETENTION_DAYS = 7;

/**
 * Permanently delete projects whose `deletedAt` is older than the retention
 * period, including their R2 storage files (drafts + published).
 */
export async function purgeExpiredSoftDeletedProjects(): Promise<{
  projectsPurged: number;
  filesRemoved: number;
}> {
  const retentionDays = parseInt(
    process.env.SOFT_DELETE_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10,
  );
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  log.info("Starting soft-delete purge", {
    retentionDays,
    cutoff: cutoff.toISOString(),
  });

  // Pull the project IDs and any published-site storage keys in one query.
  // The DB cascade removes PublishedSite rows when the project is hard-deleted,
  // but the R2 objects at `published/{slug}/...` have no cascade — we must
  // collect those storage keys BEFORE the delete or they become unreachable.
  const expired = await prisma.project.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: {
      id: true,
      publishedSites: {
        select: { storageKey: true, subdomain: true },
      },
    },
  });

  if (expired.length === 0) {
    log.info("No expired soft-deleted projects found");
    return { projectsPurged: 0, filesRemoved: 0 };
  }

  log.info(`Found ${expired.length} project(s) to purge`);

  let totalFiles = 0;

  for (const project of expired) {
    // Drafts: `projects/{projectId}/...`
    const draftPrefix = `projects/${project.id}/`;
    try {
      const allPaths = await listFiles(draftPrefix);
      if (allPaths.length > 0) {
        await deleteFiles(allPaths);
        totalFiles += allPaths.length;
        log.info("Removed draft storage files", {
          projectId: project.id,
          fileCount: allPaths.length,
        });
      }
    } catch (err) {
      log.warn(
        "Draft storage cleanup failed for project — proceeding with DB delete",
        { projectId: project.id, error: String(err) },
      );
    }

    // Published sites: `published/{slug}/index.html`. Keys come from the DB
    // rows pulled above; we already have them so no extra listFiles call.
    const publishedKeys = project.publishedSites
      .map((p) => p.storageKey)
      .filter((k): k is string => !!k);
    if (publishedKeys.length > 0) {
      try {
        await deleteFiles(publishedKeys);
        totalFiles += publishedKeys.length;
        log.info("Removed published storage files", {
          projectId: project.id,
          slugs: project.publishedSites.map((p) => p.subdomain),
          fileCount: publishedKeys.length,
        });
      } catch (err) {
        log.warn(
          "Published storage cleanup failed for project — proceeding with DB delete",
          { projectId: project.id, error: String(err) },
        );
      }
    }

    // Hard-delete the project (cascades to versions + published sites via schema).
    await prisma.project.delete({ where: { id: project.id } });
    log.info("Purged soft-deleted project", { projectId: project.id });
  }

  const result = { projectsPurged: expired.length, filesRemoved: totalFiles };
  log.info("Soft-delete purge complete", result);
  return result;
}
