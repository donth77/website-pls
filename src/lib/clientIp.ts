import { type NextRequest } from "next/server";

/**
 * Resolve the client IP from trusted proxy headers.
 *
 * Priority:
 * 1. `cf-connecting-ip` — set by Cloudflare, not spoofable by the client.
 * 2. `x-real-ip` — set by some reverse proxies (Nginx, Vercel).
 * 3. `x-forwarded-for` (rightmost entry) — the IP appended by the closest
 *    trusted proxy. The leftmost entry is client-controlled and trivially
 *    spoofed; we take the rightmost instead.
 *
 * Falls back to "unknown" if no headers are present.
 */
export function resolveClientIp(req: NextRequest): string {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost = added by the closest trusted proxy, not the client.
    const parts = forwarded.split(",").map((s) => s.trim());
    const rightmost = parts[parts.length - 1];
    if (rightmost) return rightmost;
  }

  return "unknown";
}
