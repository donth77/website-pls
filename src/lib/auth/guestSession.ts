import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { COOKIE_NAME, signSessionId } from "./cookie";
import { resolveOwner, type Owner } from "./resolveOwner";

/** Server-side constant — not stored per-row to prevent DB-level tampering. */
export const GUEST_MAX_GENERATIONS = 3;

const GUEST_SESSION_TTL_DAYS = 7;

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

  // Already authenticated or has a valid guest session.
  if (owner.type === "user") {
    return { ok: true, owner };
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

  // Rate-limit new session creation per IP (max 5/hour).
  try {
    const rl = await checkRateLimit({
      key: `guest-session-create:${clientIp}`,
      limit: 5,
      windowSeconds: 3600,
    });
    if (!rl.allowed) {
      return {
        ok: false,
        error: "Too many sessions created. Try again later.",
        code: "SESSION_RATE_LIMIT",
        httpStatus: 429,
      };
    }
  } catch {
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
    secure: process.env.NODE_ENV === "production",
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
  const result = await prisma.$queryRawUnsafe<{ generations_used: number }[]>(
    `UPDATE guest_sessions
     SET generations_used = generations_used + 1
     WHERE id = $1 AND generations_used < $2
     RETURNING generations_used`,
    guestSessionId,
    GUEST_MAX_GENERATIONS,
  );

  if (result.length === 0) {
    return { allowed: false, generationsUsed: GUEST_MAX_GENERATIONS };
  }

  return { allowed: true, generationsUsed: result[0].generations_used };
}
