import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { listFiles, deleteFiles } from "@/lib/storage/r2";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:users");

/**
 * DELETE /api/admin/users/[userId]
 *
 * Permanently delete a user and all their data. Protected by ADMIN_SECRET.
 * Call from your terminal:
 *   curl -X DELETE https://yourapp.com/api/admin/users/USER_ID \
 *     -H "Authorization: Bearer $ADMIN_SECRET"
 *
 * Cascades:
 * - DB: User → Account, Session, Project → Version, PublishedSite (Prisma schema)
 * - R2: avatars/{userId}.{ext} and projects/{projectId}/ for each owned project
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Admin endpoints not configured." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  if (
    authBuf.length !== expectedBuf.length ||
    !timingSafeEqual(authBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      projects: {
        select: {
          id: true,
          publishedSites: {
            select: { storageKey: true, subdomain: true },
          },
        },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  log.warn("Admin deleting user", {
    userId: user.id,
    email: user.email,
    projectCount: user.projects.length,
  });

  // Best-effort R2 cleanup. Proceed with DB delete even if storage calls fail —
  // orphaned objects are recoverable, but a half-deleted DB state is worse.
  let filesRemoved = 0;
  for (const project of user.projects) {
    // Drafts under projects/{id}/...
    try {
      const keys = await listFiles(`projects/${project.id}/`);
      if (keys.length > 0) {
        await deleteFiles(keys);
        filesRemoved += keys.length;
      }
    } catch (err) {
      log.warn("R2 project cleanup failed", {
        projectId: project.id,
        error: String(err),
      });
    }

    // Published sites under published/{slug}/index.html (keys already loaded).
    const publishedKeys = project.publishedSites
      .map((p) => p.storageKey)
      .filter((k): k is string => !!k);
    if (publishedKeys.length > 0) {
      try {
        await deleteFiles(publishedKeys);
        filesRemoved += publishedKeys.length;
      } catch (err) {
        log.warn("R2 published cleanup failed", {
          projectId: project.id,
          slugs: project.publishedSites.map((p) => p.subdomain),
          error: String(err),
        });
      }
    }
  }

  const avatarKeys = ["jpg", "png", "webp", "gif"].map(
    (ext) => `avatars/${user.id}.${ext}`,
  );
  try {
    await deleteFiles(avatarKeys);
  } catch (err) {
    log.warn("R2 avatar cleanup failed", {
      userId: user.id,
      error: String(err),
    });
  }

  await prisma.user.delete({ where: { id: user.id } });

  log.warn("Admin deleted user", {
    userId: user.id,
    email: user.email,
    projectsDeleted: user.projects.length,
    filesRemoved,
  });

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    projectsDeleted: user.projects.length,
    filesRemoved,
  });
}
