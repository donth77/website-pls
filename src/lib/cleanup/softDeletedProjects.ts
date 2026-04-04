import { prisma } from "@/lib/db/prisma";
import { listFiles, deleteFiles } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";

const log = createLogger("cleanup:soft-delete");

const DEFAULT_RETENTION_DAYS = 7;

/**
 * Permanently delete projects whose `deletedAt` is older than the retention
 * period, including their Supabase storage files.
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

  const expired = await prisma.project.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });

  if (expired.length === 0) {
    log.info("No expired soft-deleted projects found");
    return { projectsPurged: 0, filesRemoved: 0 };
  }

  log.info(`Found ${expired.length} project(s) to purge`);

  let totalFiles = 0;

  for (const project of expired) {
    // Clean up R2 storage (best-effort — DB delete proceeds even if this fails).
    const prefix = `projects/${project.id}/`;
    try {
      const allPaths = await listFiles(prefix);
      if (allPaths.length > 0) {
        await deleteFiles(allPaths);
        totalFiles += allPaths.length;
        log.info("Removed storage files", {
          projectId: project.id,
          fileCount: allPaths.length,
        });
      }
    } catch (err) {
      log.warn(
        "Storage cleanup failed for project — proceeding with DB delete",
        { projectId: project.id, error: String(err) },
      );
    }

    // Hard-delete the project (cascades to versions + published sites via schema).
    await prisma.project.delete({ where: { id: project.id } });
    log.info("Purged soft-deleted project", { projectId: project.id });
  }

  const result = { projectsPurged: expired.length, filesRemoved: totalFiles };
  log.info("Soft-delete purge complete", result);
  return result;
}
