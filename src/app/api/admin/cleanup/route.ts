import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { cleanupExpiredGuestSessions } from "@/lib/cleanup/guestSessions";

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

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
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
  } catch {
    // Redis down — allow through since the secret already authenticated.
  }

  const result = await cleanupExpiredGuestSessions();
  return NextResponse.json(result);
}
