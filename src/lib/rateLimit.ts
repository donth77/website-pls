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
  pipeline.zadd(redisKey, now.toString(), `${now}:${crypto.randomUUID()}`);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, opts.windowSeconds);

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;
  const allowed = count <= opts.limit;
  const remaining = Math.max(0, opts.limit - count);

  return { allowed, remaining };
}

/**
 * Fixed-window byte quota backed by Redis INCRBY. Intended for capping the
 * total bytes a caller can upload per window (e.g. RAG reference files).
 *
 * Differs from `checkRateLimit` because the increment is variable (the file
 * size), not +1 per call. The counter is consumed up-front — callers that
 * reject a request after calling this function are effectively charged the
 * bytes anyway, which is the desired behaviour for an abuse cap (reserving
 * bytes via a prior HEAD/Content-Length check would let an attacker churn
 * counters without actually uploading).
 */
export async function consumeByteQuota(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  bytes: number;
}): Promise<{ allowed: boolean; used: number }> {
  if (opts.bytes <= 0) {
    return { allowed: true, used: 0 };
  }
  const redis = getRedisConnection();
  const redisKey = `bytequota:${opts.key}`;

  const pipeline = redis.pipeline();
  pipeline.incrby(redisKey, opts.bytes);
  pipeline.expire(redisKey, opts.windowSeconds, "NX");
  const results = await pipeline.exec();
  const used = (results?.[0]?.[1] as number) ?? 0;

  return { allowed: used <= opts.limit, used };
}
