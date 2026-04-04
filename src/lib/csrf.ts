import { type NextRequest, NextResponse } from "next/server";

/**
 * Validate the Origin header against the request's Host to prevent CSRF.
 *
 * Returns null if the request is safe, or a 403 NextResponse if the
 * Origin is cross-site. Should be called on all state-changing endpoints
 * (POST, PATCH, DELETE).
 *
 * The admin cleanup endpoint is exempt (uses Bearer token auth, not cookies).
 */
export function validateCsrf(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");

  // Requests without an Origin header (e.g., server-to-server, same-origin
  // fetch without mode: "cors") are allowed — SameSite=lax cookies already
  // block cross-site cookie attachment for these cases.
  if (!origin) return null;

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return null;
  } catch {
    // Malformed Origin header.
  }

  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}
