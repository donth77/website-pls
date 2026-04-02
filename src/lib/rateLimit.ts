import { getRedisConnection } from "@/lib/queue/redis";

/**
 * Sliding-window rate limiter backed by Redis.
 * Uses a sorted set with timestamps; expired entries are pruned on each check.
 */
export async function checkRateLimit(opts: {
  /** Unique key for the rate limit bucket (e.g. `generate:${ip}`). */
  key: string;
  /** Maximum requests allowed within the window. */
  limit: number;
  /** Window duration in seconds. */
  windowSeconds: number;
}): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedisConnection();
  const redisKey = `ratelimit:${opts.key}`;
  const now = Date.now();
  const windowStart = now - opts.windowSeconds * 1000;

  // Atomic: remove expired entries, add current, count, set TTL.
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zadd(redisKey, now.toString(), `${now}:${Math.random()}`);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, opts.windowSeconds);

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;
  const allowed = count <= opts.limit;
  const remaining = Math.max(0, opts.limit - count);

  return { allowed, remaining };
}
