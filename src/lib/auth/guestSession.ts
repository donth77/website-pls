import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { ErrorCode } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { recordEvent, recordRateLimitHit } from "@/lib/admin/metrics";
import { COOKIE_NAME, signSessionId } from "./cookie";
import { resolveOwner, type Owner } from "./resolveOwner";
import { recordAuthenticatedIp, isAuthenticatedIp } from "./ipBlock";

const log = createLogger("auth:guest-session");

/** Server-side constant — not stored per-row to prevent DB-level tampering. */
export const GUEST_MAX_GENERATIONS = parseInt(
  process.env.GUEST_MAX_GENERATIONS ?? "3",
  10,
);

const GUEST_SESSION_TTL_DAYS = 7;
const GUEST_SESSION_CREATE_LIMIT = parseInt(
  process.env.GUEST_SESSION_CREATE_PER_HR ?? "2",
  10,
);

type EnsureResult =
  | { ok: true; owner: Owner & { type: "guest" | "user" } }
  | { ok: false; error: string; code: string; httpStatus: number };

/**
 * Ensure the caller has a valid guest session (or authenticated user session).
 * If no session exists, creates a new GuestSession after rate-limiting new
 * session creation per IP. Sets the signed cookie on the response.
 *
 * Call from route handlers (Node.js runtime) — not middleware (Edge runtime).
 */
export async function ensureGuestSession(
  clientIp: string,
): Promise<EnsureResult> {
  const owner = await resolveOwner();

  // Already authenticated — record IP so future guest attempts are blocked.
  if (owner.type === "user") {
    await recordAuthenticatedIp(clientIp);
    return { ok: true, owner };
  }

  // Block guest access from IPs that have been used by an authenticated user.
  if (await isAuthenticatedIp(clientIp)) {
    return {
      ok: false,
      error:
        "An account has already been used from this network. Please sign in to continue.",
      code: ErrorCode.GUEST_BLOCKED_AUTH_IP,
      httpStatus: 403,
    };
  }

  if (owner.type === "guest") {
    // Verify the session still exists and hasn't expired.
    const session = await prisma.guestSession.findUnique({
      where: { id: owner.guestSessionId },
      select: { id: true, expiresAt: true },
    });

    if (session && session.expiresAt > new Date()) {
      return { ok: true, owner };
    }

    // Session expired or deleted — fall through to create a new one.
  }

  // Rate-limit new session creation per IP (max 2/hour).
  try {
    const rl = await checkRateLimit({
      key: `guest-session-create:${clientIp}`,
      limit: GUEST_SESSION_CREATE_LIMIT,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      log.warn("guest session creation rate limit exceeded", {
        event: "rate_limit.hit",
        endpoint: "guest-session-create",
        clientIp,
        limit: GUEST_SESSION_CREATE_LIMIT,
        remaining: rl.remaining,
        status: 429,
      });
      void recordRateLimitHit("guest-session-create", clientIp).catch(() => {});
      void recordEvent("rate_limit.hit", {
        endpoint: "guest-session-create",
        clientIp,
        limit: GUEST_SESSION_CREATE_LIMIT,
      }).catch(() => {});
      return {
        ok: false,
        error: "Too many sessions created. Try again later.",
        code: ErrorCode.SESSION_RATE_LIMIT,
        httpStatus: 429,
      };
    }
  } catch (err) {
    log.warn("guest session rate limit check failed, allowing", {
      event: "rate_limit.failed_open",
      endpoint: "guest-session-create",
      clientIp,
      error: String(err),
    });
    // Redis down — fail open for session creation (generation rate limit
    // still applies as a secondary layer).
  }

  // Create a new guest session.
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + GUEST_SESSION_TTL_DAYS);

  const session = await prisma.guestSession.create({
    data: {
      ipAddress: clientIp,
      expiresAt,
    },
  });

  // Set the signed cookie.
  const jar = await cookies();
  jar.set(COOKIE_NAME, signSessionId(session.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return {
    ok: true,
    owner: { type: "guest", guestSessionId: session.id },
  };
}

/**
 * Atomically increment `generationsUsed` and return whether the generation
 * is allowed. Uses a conditional UPDATE so concurrent requests can't bypass
 * the cap.
 */
export async function consumeGuestGeneration(
  guestSessionId: string,
): Promise<{ allowed: boolean; generationsUsed: number }> {
  // Atomic: only increments if current count is below the cap.
  const result = await prisma.$queryRaw<{ generations_used: number }[]>`
    UPDATE guest_sessions
    SET generations_used = generations_used + 1
    WHERE id = ${guestSessionId} AND generations_used < ${GUEST_MAX_GENERATIONS}
    RETURNING generations_used
  `;

  if (result.length === 0) {
    return { allowed: false, generationsUsed: GUEST_MAX_GENERATIONS };
  }

  return { allowed: true, generationsUsed: result[0].generations_used };
}
