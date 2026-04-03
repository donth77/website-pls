import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return secret;
}

const COOKIE_NAME = "guest_session";
const SEPARATOR = ".";

/** Sign a guest session ID: `id.hmac` */
export function signSessionId(sessionId: string): string {
  const sig = createHmac("sha256", getAuthSecret())
    .update(sessionId)
    .digest("base64url");
  return `${sessionId}${SEPARATOR}${sig}`;
}

/**
 * Verify a signed cookie value and return the session ID, or `null` if
 * the signature is invalid or the format is wrong.
 */
export function verifySessionId(cookieValue: string): string | null {
  const idx = cookieValue.lastIndexOf(SEPARATOR);
  if (idx === -1) return null;

  const sessionId = cookieValue.slice(0, idx);
  const providedSig = cookieValue.slice(idx + 1);

  const expectedSig = createHmac("sha256", getAuthSecret())
    .update(sessionId)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks.
  const a = Buffer.from(providedSig, "utf-8");
  const b = Buffer.from(expectedSig, "utf-8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return sessionId;
}

export { COOKIE_NAME };
