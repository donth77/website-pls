import { getRedisConnection } from "@/lib/queue/redis";

/**
 * Redis-backed operator metrics for the admin dashboard.
 *
 * Three data sources, all queried from `GET /api/admin/metrics`:
 *
 *   1. **Point-in-time rate-limit state** — scanned live from the existing
 *      `ratelimit:*` sorted sets. Shows who is currently near their limit.
 *      No write path (the rate limiter already populates these).
 *
 *   2. **Cumulative rate-limit counters** — per-day hashes at
 *      `metrics:rate_limit:{YYYY-MM-DD}`, incremented on every rate-limit
 *      hit. Retention: 7 days via Redis TTL.
 *
 *   3. **Recent events ring** — a single list at `metrics:recent_events`,
 *      capped at 500 entries via LTRIM. Captures policy events in
 *      chronological order for at-a-glance incident response.
 *
 * All writes are fire-and-forget. Callers should `.catch(() => {})` the
 * returned promises — metrics writes must never cause request failures.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTER_RETENTION_DAYS = 7;
const COUNTER_TTL_SECONDS = COUNTER_RETENTION_DAYS * 24 * 60 * 60;
const RECENT_EVENTS_KEY = "metrics:recent_events";
const RECENT_EVENTS_MAX = 500;

/**
 * Map from the rate-limit key prefix (after stripping the `ratelimit:`
 * literal prefix) to the bucket's human name and configured limit. The
 * limits come from env vars / literals in the rate-limiter call sites;
 * they're duplicated here so the dashboard can show `current/limit`
 * instead of just `current`. If the env var is missing the default value
 * is used — matches the defaults elsewhere in the code.
 */
function rateLimitBuckets(): Array<{
  prefix: string;
  label: string;
  limit: number;
  idField: "userId" | "guestSessionId" | "clientIp";
}> {
  return [
    {
      prefix: "publish:",
      label: "POST /api/publish",
      limit: parseInt(process.env.RATE_LIMIT_PUBLISH_PER_HR ?? "5", 10),
      idField: "userId",
    },
    {
      prefix: "generate:user:",
      label: "POST /api/generate (user)",
      limit: parseInt(process.env.RATE_LIMIT_USER_PER_HR ?? "20", 10),
      idField: "userId",
    },
    {
      prefix: "generate:guest:",
      label: "POST /api/generate (guest)",
      limit: parseInt(process.env.RATE_LIMIT_GUEST_PER_HR ?? "10", 10),
      idField: "guestSessionId",
    },
    {
      prefix: "guest-session-create:",
      label: "guest-session-create",
      limit: parseInt(process.env.GUEST_SESSION_CREATE_PER_HR ?? "2", 10),
      idField: "clientIp",
    },
    {
      prefix: "admin-auth:",
      label: "admin-auth",
      limit: 30,
      idField: "clientIp",
    },
  ];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitSnapshotEntry {
  bucket: string;
  label: string;
  id: string;
  idField: "userId" | "guestSessionId" | "clientIp";
  current: number;
  limit: number;
  atLimit: boolean;
}

export interface RateLimitCounterEntry {
  day: string; // YYYY-MM-DD
  bucket: string;
  id: string;
  count: number;
}

export interface RecentEvent {
  event: string;
  at: number;
  [key: string]: unknown;
}

export interface MetricsSnapshot {
  generatedAt: string;
  rateLimits: RateLimitSnapshotEntry[];
  rateLimitsHistory: RateLimitCounterEntry[];
  recentEvents: RecentEvent[];
}

// ---------------------------------------------------------------------------
// Reads — used by the admin endpoint and dashboard
// ---------------------------------------------------------------------------

/**
 * Scan the live `ratelimit:*` keyspace and return current usage per entity.
 *
 * The rate limiter uses ZADD + ZREMRANGEBYSCORE with timestamps, so the
 * cardinality of each sorted set equals the number of requests in the
 * current sliding window. ZCARD is O(1).
 *
 * SCAN with COUNT 200 is fine for the current scale (a few hundred keys
 * at most). If Redis ever holds thousands of active rate-limit buckets,
 * either raise COUNT or page from the caller.
 */
export async function scanRateLimitState(): Promise<RateLimitSnapshotEntry[]> {
  const redis = getRedisConnection();
  const buckets = rateLimitBuckets();
  const entries: RateLimitSnapshotEntry[] = [];

  for (const bucket of buckets) {
    const matchPattern = `ratelimit:${bucket.prefix}*`;
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(
        cursor,
        "MATCH",
        matchPattern,
        "COUNT",
        200,
      );
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length === 0) continue;

    // Batch ZCARD via pipeline for efficiency under many keys.
    const pipeline = redis.pipeline();
    for (const k of keys) pipeline.zcard(k);
    const results = await pipeline.exec();

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const result = results?.[i];
      if (!result || result[0]) continue;
      const current = Number(result[1] ?? 0);
      if (current === 0) continue; // skip empty keys that haven't been GC'd yet

      const id = k.slice(`ratelimit:${bucket.prefix}`.length);
      entries.push({
        bucket: bucket.prefix.replace(/:$/, ""),
        label: bucket.label,
        id,
        idField: bucket.idField,
        current,
        limit: bucket.limit,
        atLimit: current >= bucket.limit,
      });
    }
  }

  // Sort: at-limit first, then by current descending — operators want to
  // see the hottest entries at the top of the table.
  entries.sort((a, b) => {
    if (a.atLimit !== b.atLimit) return a.atLimit ? -1 : 1;
    return b.current - a.current;
  });

  return entries;
}

/**
 * Read the last N days of per-user rate-limit hit counters.
 *
 * Counters live at `metrics:rate_limit:YYYY-MM-DD` as Redis hashes, with
 * fields like `publish:user-42 = 17`. One HGETALL per day × 7 days = 7
 * round-trips worst case; negligible at this scale.
 */
export async function readRateLimitCounters(
  days: number,
): Promise<RateLimitCounterEntry[]> {
  const redis = getRedisConnection();
  const clampedDays = Math.max(1, Math.min(days, COUNTER_RETENTION_DAYS));
  const entries: RateLimitCounterEntry[] = [];

  const now = new Date();
  for (let i = 0; i < clampedDays; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const hash = await redis.hgetall(`metrics:rate_limit:${day}`);
    for (const [field, value] of Object.entries(hash)) {
      const sep = field.indexOf(":");
      if (sep < 0) continue;
      const bucket = field.slice(0, sep);
      const id = field.slice(sep + 1);
      entries.push({
        day,
        bucket,
        id,
        count: Number(value),
      });
    }
  }

  // Sort: highest count first so attackers/heavy users are at the top.
  entries.sort((a, b) => b.count - a.count);

  return entries;
}

/**
 * Read the last N entries from the recent-events ring.
 */
export async function readRecentEvents(limit: number): Promise<RecentEvent[]> {
  const redis = getRedisConnection();
  const clamped = Math.max(1, Math.min(limit, RECENT_EVENTS_MAX));
  const raw = await redis.lrange(RECENT_EVENTS_KEY, 0, clamped - 1);
  const events: RecentEvent[] = [];
  for (const line of raw) {
    try {
      events.push(JSON.parse(line) as RecentEvent);
    } catch {
      // Malformed entry — skip. The ring is append-only and self-trimming
      // so corrupt entries will age out on their own.
    }
  }
  return events;
}

/**
 * Convenience wrapper returning the full snapshot used by the dashboard.
 */
export async function readMetricsSnapshot(opts: {
  days: number;
  recent: number;
}): Promise<MetricsSnapshot> {
  const [rateLimits, rateLimitsHistory, recentEvents] = await Promise.all([
    scanRateLimitState(),
    readRateLimitCounters(opts.days),
    readRecentEvents(opts.recent),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    rateLimits,
    rateLimitsHistory,
    recentEvents,
  };
}

// ---------------------------------------------------------------------------
// Writes — called from rate-limit rejection paths. Fire-and-forget.
// ---------------------------------------------------------------------------

/**
 * Record a rate-limit hit in the cumulative counters. Idempotent per
 * caller — increments by 1. Safe to call without await.
 *
 * @param bucket - matches the rate-limit key prefix, e.g. "publish",
 *   "generate:user", "guest-session-create"
 * @param id - userId, guestSessionId, or clientIp
 */
export async function recordRateLimitHit(
  bucket: string,
  id: string,
): Promise<void> {
  const redis = getRedisConnection();
  const day = new Date().toISOString().slice(0, 10);
  const key = `metrics:rate_limit:${day}`;
  const field = `${bucket}:${id}`;
  await redis
    .pipeline()
    .hincrby(key, field, 1)
    .expire(key, COUNTER_TTL_SECONDS)
    .exec();
}

/**
 * Append a policy event to the rolling recent-events list. Auto-trimmed
 * to `RECENT_EVENTS_MAX` entries.
 *
 * Callers should pass the same structured payload they log — the field
 * names are arbitrary but `event` and `at` are conventional so the
 * dashboard can render them consistently.
 */
export async function recordEvent(
  event: string,
  context: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisConnection();
  const payload = JSON.stringify({
    event,
    at: Date.now(),
    ...context,
  });
  await redis
    .pipeline()
    .lpush(RECENT_EVENTS_KEY, payload)
    .ltrim(RECENT_EVENTS_KEY, 0, RECENT_EVENTS_MAX - 1)
    .exec();
}
