import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth/resolveOwner";
import { prisma } from "@/lib/db/prisma";
import { GUEST_MAX_GENERATIONS } from "@/lib/auth/guestSession";
import { uploadFile, deleteFiles, listFiles } from "@/lib/storage/r2";
import { getGenerationQueue } from "@/lib/queue/generationQueue";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:me");

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function GET() {
  const owner = await resolveOwner();

  if (owner.type === "user") {
    if (process.env.ENABLE_MONETIZATION === "true") {
      const user = await prisma.user.findUnique({
        where: { id: owner.userId },
        select: { credits: true },
      });
      return NextResponse.json({
        type: "user",
        generationsRemaining: user?.credits ?? 0,
      });
    }
    return NextResponse.json({ type: "user" });
  }

  if (owner.type === "guest") {
    const session = await prisma.guestSession.findUnique({
      where: { id: owner.guestSessionId },
      select: { generationsUsed: true },
    });
    const used = session?.generationsUsed ?? 0;
    return NextResponse.json({
      type: "guest",
      generationsRemaining: Math.max(0, GUEST_MAX_GENERATIONS - used),
      generationsMax: GUEST_MAX_GENERATIONS,
    });
  }

  return NextResponse.json({
    type: "anonymous",
    generationsRemaining: GUEST_MAX_GENERATIONS,
    generationsMax: GUEST_MAX_GENERATIONS,
  });
}

export async function PATCH(req: NextRequest) {
  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const name = formData.get("name");
  const avatar = formData.get("avatar");

  const data: { name?: string; image?: string } = {};

  if (typeof name === "string") {
    data.name = name.trim() || undefined;
  }

  // Handle avatar upload
  if (avatar instanceof File && avatar.size > 0) {
    if (!ALLOWED_AVATAR_TYPES.has(avatar.type)) {
      return NextResponse.json(
        { error: "Invalid image type. Use JPEG, PNG, WebP, or GIF." },
        { status: 400 },
      );
    }
    if (avatar.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        { error: "Image must be under 2 MB." },
        { status: 400 },
      );
    }

    const ext =
      avatar.type.split("/")[1] === "jpeg" ? "jpg" : avatar.type.split("/")[1];
    const key = `avatars/${owner.userId}.${ext}`;

    // Delete any existing avatars with different extensions to prevent stale files.
    const otherKeys = ["jpg", "png", "webp", "gif"]
      .filter((e) => e !== ext)
      .map((e) => `avatars/${owner.userId}.${e}`);
    await deleteFiles(otherKeys);

    const buffer = Buffer.from(await avatar.arrayBuffer());
    await uploadFile(key, buffer, avatar.type);

    // Point to our proxy route so Next.js Image can serve it
    data.image = `/api/me/avatar?v=${Date.now()}`;

    log.info("Avatar uploaded", {
      userId: owner.userId,
      key,
      size: avatar.size,
    });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: owner.userId },
    data,
    select: { id: true, name: true, image: true },
  });

  return NextResponse.json(user);
}

/**
 * Hard-delete the authenticated user's account and all associated data.
 *
 * Order of operations is deliberate:
 *   1. Collect resource identifiers BEFORE deletion — once the User row
 *      is gone the cascade also removes Projects, so we can't enumerate
 *      version IDs / published slugs after the fact.
 *   2. Best-effort BullMQ job cancellation. Worker handles missing
 *      projects gracefully, but pre-cancelling stops the job from doing
 *      pointless Anthropic spend during/after deletion.
 *   3. Best-effort R2 object cleanup. Postgres `onDelete: Cascade`
 *      doesn't touch object storage. Failures here are logged but don't
 *      abort the delete — the existing orphaned-storage cleanup job is
 *      the safety net.
 *   4. `prisma.user.delete` — cascades Account, Session, Project →
 *      Version / ReferenceDocument / PublishedSite / KnowledgeChunk.
 *
 * Client is responsible for calling next-auth/react `signOut()` after
 * a 204 to clear the local JWT cookie and redirect.
 */
export async function DELETE() {
  const owner = await resolveOwner();
  if (owner.type !== "user") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = owner.userId;

  // 1. Collect everything we need to clean up before the cascade fires.
  const projects = await prisma.project.findMany({
    where: { userId },
    select: {
      id: true,
      versions: {
        where: { storageKey: null }, // only in-flight versions to cancel
        select: { id: true },
      },
      publishedSites: {
        select: { subdomain: true, storageKey: true },
      },
    },
  });
  const projectIds = projects.map((p) => p.id);
  const pendingVersionIds = projects.flatMap((p) =>
    p.versions.map((v) => v.id),
  );
  const publishedKeys = projects.flatMap((p) =>
    p.publishedSites
      .map((s) => s.storageKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0),
  );

  // 2. Best-effort BullMQ cancellation. job.id === versionId per the
  //    enqueue contract in /api/generate.
  let cancelledJobs = 0;
  try {
    const queue = getGenerationQueue();
    const results = await Promise.allSettled(
      pendingVersionIds.map(async (versionId) => {
        const job = await queue.getJob(versionId);
        if (job) {
          await job.remove();
          return true;
        }
        return false;
      }),
    );
    cancelledJobs = results.filter(
      (r) => r.status === "fulfilled" && r.value === true,
    ).length;
  } catch (err) {
    log.warn("BullMQ cancel-on-delete failed (continuing)", {
      userId,
      error: String(err),
    });
  }

  // 3. R2 cleanup. Three prefix patterns + the four possible avatar
  //    extensions. allSettled so a single failure doesn't abort.
  const r2DeletePromises: Promise<unknown>[] = [];
  // Avatars (any extension — we don't know which one the user uploaded).
  r2DeletePromises.push(
    deleteFiles(
      ["jpg", "png", "webp", "gif"].map((e) => `avatars/${userId}.${e}`),
    ),
  );
  // Project data: references + version HTML, all under projects/{id}/
  for (const pid of projectIds) {
    r2DeletePromises.push(
      (async () => {
        const keys = await listFiles(`projects/${pid}/`);
        if (keys.length > 0) await deleteFiles(keys);
      })(),
    );
  }
  // Published HTML (separate prefix structure).
  if (publishedKeys.length > 0) {
    r2DeletePromises.push(deleteFiles(publishedKeys));
  }
  const r2Results = await Promise.allSettled(r2DeletePromises);
  const r2Failures = r2Results.filter((r) => r.status === "rejected").length;

  // 4. The actual hard delete — cascades clean up everything else.
  await prisma.user.delete({ where: { id: userId } });

  log.info("Account deleted", {
    event: "account.deleted",
    userId,
    projects: projectIds.length,
    publishedSites: publishedKeys.length,
    cancelledJobs,
    r2Failures,
  });

  // Client is expected to call signOut() to clear the local cookie.
  return new NextResponse(null, { status: 204 });
}
