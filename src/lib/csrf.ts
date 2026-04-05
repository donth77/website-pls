import { type NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { recordEvent } from "@/lib/admin/metrics";

const log = createLogger("csrf");

/**
 * Validate the Origin header against the request's Host to prevent CSRF.
 *
 * Returns null if the request is safe, or a 403 NextResponse if the
 * Origin is cross-site. Should be called on all state-changing endpoints
 * (POST, PATCH, DELETE).
 *
 * The admin cleanup endpoint is exempt (uses Bearer token auth, not cookies).
 *
 * Pass an `endpoint` label for observability — it's attached to rejection
 * logs so dashboards can break CSRF events down by route.
 */
export function validateCsrf(
  req: NextRequest,
  endpoint?: string,
): NextResponse | null {
  const origin = req.headers.get("origin");

  // Requests without an Origin header (e.g., server-to-server, same-origin
  // fetch without mode: "cors") are allowed — SameSite=lax cookies already
  // block cross-site cookie attachment for these cases.
  if (!origin) return null;

  const host = req.headers.get("host");
  if (!host) {
    log.warn("csrf rejected: missing host header", {
      event: "csrf.rejected",
      endpoint,
      origin,
      reason: "missing_host",
      status: 403,
    });
    void recordEvent("csrf.rejected", {
      endpoint,
      origin,
      reason: "missing_host",
    }).catch(() => {});
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return null;
    log.warn("csrf rejected: origin host mismatch", {
      event: "csrf.rejected",
      endpoint,
      origin,
      originHost,
      host,
      reason: "origin_mismatch",
      status: 403,
    });
    void recordEvent("csrf.rejected", {
      endpoint,
      origin,
      originHost,
      host,
      reason: "origin_mismatch",
    }).catch(() => {});
  } catch {
    log.warn("csrf rejected: malformed origin", {
      event: "csrf.rejected",
      endpoint,
      origin,
      host,
      reason: "malformed_origin",
      status: 403,
    });
    void recordEvent("csrf.rejected", {
      endpoint,
      origin,
      host,
      reason: "malformed_origin",
    }).catch(() => {});
  }

  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}
