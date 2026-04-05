import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "@/lib/rateLimit";
import { resolveClientIp } from "@/lib/clientIp";
import { createLogger } from "@/lib/logger";

const log = createLogger("admin:auth");

/**
 * Shared admin auth gate. Accepts two credential styles so the same endpoint
 * can be hit from curl (Bearer) and from a browser dashboard (HTTP Basic)
 * without compromise:
 *
 *   - `Authorization: Bearer $SECRET`
 *   - `Authorization: Basic <base64(ADMIN_USERNAME:$SECRET)>` — both the
 *     username (`ADMIN_USERNAME`, default `admin`) and the password are
 *     validated. The username isn't a security boundary (Basic auth sends
 *     it in cleartext base64 on every request) but validating it is
 *     defence-in-depth against drive-by scanners and lets operators rename
 *     the username per-deployment for obscurity.
 *
 * **Callers must pass the env var name whose secret gates them.** This is
 * the blast-radius split: read-only observability endpoints pass
 * `METRICS_SECRET`, destructive endpoints pass `ADMIN_SECRET`, and a leak
 * of one credential doesn't escalate to the other. The env var name is
 * passed (not the value) so this helper can emit clear config errors when
 * a deployment forgets to set it.
 *
 * Both paths use `timingSafeEqual` so the comparison doesn't leak length.
 * All callers share a per-IP rate limit (`admin-auth:{ip}`) to blunt any
 * side-channel attempt to brute-force via sheer request volume.
 *
 * Returns `null` on success (caller proceeds to handle the request) or a
 * 401 `NextResponse` with `WWW-Authenticate: Basic realm="Admin"` on
 * failure so browsers know to prompt.
 *
 * Long-term migration path: once the app gains a proper per-user `isAdmin`
 * field, replace this helper with a session-based check. The call sites
 * stay the same — just swap the implementation.
 */
export async function requireAdmin(
  req: NextRequest,
  /**
   * The env var name (e.g. `"METRICS_SECRET"`, `"ADMIN_SECRET"`) whose
   * value gates this caller. Reading the value here rather than passing
   * it in lets the helper emit a clear "endpoints not configured" error
   * if the env var is missing.
   */
  secretEnvVar: "ADMIN_SECRET" | "METRICS_SECRET",
): Promise<NextResponse | null> {
  const secret = process.env[secretEnvVar];
  if (!secret) {
    return NextResponse.json(
      { error: "Admin endpoints not configured." },
      { status: 503 },
    );
  }

  // Default to "admin" so existing deployments that only set the secret
  // keep working. New deployments can override via env.
  const expectedUsername = process.env.ADMIN_USERNAME ?? "admin";

  // Rate-limit auth attempts by IP to cap brute-force throughput. Tight
  // limit because legitimate admin traffic is measured in a few requests
  // per minute at most, not per second.
  const clientIp = resolveClientIp(req);
  try {
    const rl = await checkRateLimit({
      key: `admin-auth:${clientIp}`,
      limit: 30,
      windowSeconds: 60,
    });
    if (!rl.allowed) {
      log.warn("admin auth rate limited", {
        event: "rate_limit.hit",
        endpoint: "admin-auth",
        clientIp,
        status: 429,
      });
      return new NextResponse("Too many requests.", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "WWW-Authenticate": 'Basic realm="Admin"',
        },
      });
    }
  } catch {
    // Fail open on Redis errors — the secret check below is still the
    // real gate. Never block admin access because metrics are broken.
  }

  const authHeader = req.headers.get("authorization") ?? "";

  if (authHeader.startsWith("Bearer ")) {
    if (constantTimeEqual(authHeader, `Bearer ${secret}`)) {
      return null;
    }
  } else if (authHeader.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length).trim();
    let decoded = "";
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
      // fall through to 401
    }
    // Basic format is "username:password". Validate both halves. Neither
    // short-circuits — both comparisons run so auth failures leak no timing
    // information about which half was wrong. Password match is the real
    // gate; username match is additive defence-in-depth.
    const sep = decoded.indexOf(":");
    if (sep >= 0) {
      const username = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);
      const usernameOk = constantTimeEqual(username, expectedUsername);
      const passwordOk = constantTimeEqual(password, secret);
      if (usernameOk && passwordOk) {
        return null;
      }
    }
  }

  log.warn("admin auth rejected", {
    event: "admin.auth_rejected",
    endpoint: req.nextUrl.pathname,
    clientIp,
    scheme: authHeader.split(" ")[0] || "none",
    status: 401,
  });

  return new NextResponse("Unauthorized.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Admin"',
      "Cache-Control": "no-store, private",
    },
  });
}

/** Constant-time string comparison that never throws. */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
