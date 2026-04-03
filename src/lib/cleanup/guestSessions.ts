import { prisma } from "@/lib/db/prisma";
import { getGeneratedBucket, getSupabaseAdmin } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("cleanup");

/**
 * Delete expired guest sessions and their orphaned projects + Supabase storage.
 * Returns the number of sessions cleaned up.
 */
export async function cleanupExpiredGuestSessions(): Promise<{
  sessionsDeleted: number;
  projectsDeleted: number;
  filesRemoved: number;
}> {
  const now = new Date();
  log.info("Starting guest session cleanup", { now: now.toISOString() });

  // Fetch expired sessions with their orphaned projects in one query (avoids N+1).
  const expired = await prisma.guestSession.findMany({
    where: { expiresAt: { lt: now } },
    select: {
      id: true,
      projects: {
        where: { userId: null },
        select: { id: true },
      },
    },
  });

  if (expired.length === 0) {
    log.info("No expired sessions found");
    return { sessionsDeleted: 0, projectsDeleted: 0, filesRemoved: 0 };
  }

  log.info(`Found ${expired.length} expired session(s)`);

  const supabase = getSupabaseAdmin();
  const bucket = getGeneratedBucket();
  let totalProjects = 0;
  let totalFiles = 0;

  for (const session of expired) {
    for (const project of session.projects) {
      const prefix = `projects/${project.id}/`;
      const { data: files } = await supabase.storage
        .from(bucket)
        .list(prefix.slice(0, -1));

      if (files && files.length > 0) {
        const allPaths: string[] = [];
        for (const file of files) {
          if (file.id) {
            allPaths.push(`${prefix}${file.name}`);
          } else {
            const { data: subFiles } = await supabase.storage
              .from(bucket)
              .list(`${prefix}${file.name}`);
            if (subFiles) {
              for (const sub of subFiles) {
                allPaths.push(`${prefix}${file.name}/${sub.name}`);
              }
            }
          }
        }

        if (allPaths.length > 0) {
          await supabase.storage.from(bucket).remove(allPaths);
          totalFiles += allPaths.length;
          log.info("Removed storage files", {
            projectId: project.id,
            fileCount: allPaths.length,
          });
        }
      }
    }

    if (session.projects.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: session.projects.map((p) => p.id) } },
      });
      totalProjects += session.projects.length;
      log.info("Deleted orphaned projects", {
        guestSessionId: session.id,
        projectCount: session.projects.length,
      });
    }

    await prisma.guestSession.delete({ where: { id: session.id } });
  }

  const result = {
    sessionsDeleted: expired.length,
    projectsDeleted: totalProjects,
    filesRemoved: totalFiles,
  };
  log.info("Cleanup complete", result);
  return result;
}
