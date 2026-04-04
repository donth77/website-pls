import { getRedisConnection } from "@/lib/queue/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:ip-block");

/** How long an IP stays flagged after an authenticated user uses it (30 days). */
const AUTH_IP_TTL_SECONDS = 30 * 24 * 60 * 60;

function redisKey(ip: string): string {
  return `auth-ip:${ip}`;
}

/**
 * Record that an authenticated user has been seen from this IP.
 * Non-blocking — failures are logged but never throw.
 */
export async function recordAuthenticatedIp(ip: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.set(redisKey(ip), "1", "EX", AUTH_IP_TTL_SECONDS);
  } catch (err) {
    log.warn("Failed to record authenticated IP", { error: String(err) });
  }
}

/**
 * Check whether this IP has previously been used by an authenticated user.
 * Returns `false` if Redis is unreachable (fail-open).
 */
export async function isAuthenticatedIp(ip: string): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const exists = await redis.exists(redisKey(ip));
    return exists === 1;
  } catch (err) {
    log.warn("Failed to check authenticated IP, allowing guest", {
      error: String(err),
    });
    return false;
  }
}
