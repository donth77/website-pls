import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { readMetricsSnapshot } from "@/lib/admin/metrics";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:admin:metrics");

/**
 * GET /api/admin/metrics
 *
 * Returns a JSON snapshot of current operational state:
 *
 *   - `rateLimits`: live point-in-time view of who is in each rate-limit
 *     bucket, scanned from Redis
 *   - `rateLimitsHistory`: per-day counter of rate-limit hits per (bucket, id)
 *     over the last N days (default 7, capped at the 7-day Redis TTL)
 *   - `recentEvents`: last N policy events (rate limits, CSRF, size caps,
 *     etc.) in chronological order (newest first), default 50 capped at 500
 *
 * Protected by `METRICS_SECRET` via Bearer token OR HTTP Basic auth —
 * the dual path is so the same URL works from curl and from a browser-based
 * dashboard without compromises. This is a DIFFERENT secret from
 * `ADMIN_SECRET` (which gates destructive endpoints like user deletion)
 * so a leak of one credential doesn't escalate to the other.
 *
 *   curl -u admin:$METRICS_SECRET https://host/api/admin/metrics
 *   curl -H "Authorization: Bearer $METRICS_SECRET" https://host/api/admin/metrics
 *
 * Query params:
 *   ?days=7    (1–7, defaults to 7)
 *   ?recent=50 (1–500, defaults to 50)
 */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "METRICS_SECRET");
  if (unauthorized) return unauthorized;

  const daysParam = req.nextUrl.searchParams.get("days");
  const recentParam = req.nextUrl.searchParams.get("recent");
  const days = daysParam ? Math.max(1, parseInt(daysParam, 10) || 7) : 7;
  const recent = recentParam
    ? Math.max(1, parseInt(recentParam, 10) || 50)
    : 50;

  try {
    const snapshot = await readMetricsSnapshot({ days, recent });
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    log.error("metrics snapshot failed", { error: String(err) });
    return NextResponse.json(
      { error: "Could not read metrics." },
      { status: 500, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}
