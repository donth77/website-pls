import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "@/lib/rateLimit";
import { cleanupExpiredGuestSessions } from "@/lib/cleanup/guestSessions";
import { purgeExpiredSoftDeletedProjects } from "@/lib/cleanup/softDeletedProjects";
import { purgeOrphanedR2Objects } from "@/lib/cleanup/orphanedStorage";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:cleanup");

/**
 * POST /api/admin/cleanup
 *
 * Trigger guest session cleanup. Protected by CLEANUP_SECRET + rate limited (1/hr).
 * Call from a cron service (Cloudflare, GitHub Actions, cron-job.org, etc.):
 *   curl -X POST https://yourapp.com/api/admin/cleanup \
 *     -H "Authorization: Bearer $CLEANUP_SECRET"
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLEANUP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Cleanup not configured." },
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

  // Max 1 cleanup per hour — limits damage even if the secret leaks.
  try {
    const rl = await checkRateLimit({
      key: "admin:cleanup",
      limit: 1,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Cleanup already ran recently. Try again later." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  } catch (err) {
    log.warn("Redis rate-limit check failed — allowing through", {
      error: String(err),
    });
  }

  const [guestSessions, softDeletePurge, orphanedStorage] = await Promise.all([
    cleanupExpiredGuestSessions(),
    purgeExpiredSoftDeletedProjects(),
    purgeOrphanedR2Objects(),
  ]);

  return NextResponse.json({ guestSessions, softDeletePurge, orphanedStorage });
}
