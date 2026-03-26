import IORedis from "ioredis";
import type { RedisOptions } from "ioredis";

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function validateRedisUrl(url: string) {
  if (!url.startsWith("redis://") && !url.startsWith("rediss://")) {
    throw new Error(
      "REDIS_URL must start with redis:// or rediss:// (use the Redis protocol URL from Upstash, not the REST URL).",
    );
  }
}

/**
 * BullMQ's internal non-shared Redis connection uses this backoff so retries
 * do not hammer the server in the first seconds after a drop. ioredis's
 * default is much more aggressive (50ms, 100ms, …) and can worsen ECONNRESET
 * loops with managed Redis (e.g. Upstash).
 */
function bullMqStyleRetryStrategy(times: number): number {
  return Math.max(Math.min(Math.exp(times), 20_000), 1000);
}

function parseFamily(): number | undefined {
  const f = process.env.REDIS_FAMILY;
  if (f === "4" || f === "6") return Number(f);
  return undefined;
}

type ParsedRedisUrl = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

/**
 * Expand REDIS_URL into discrete ioredis fields. Upstash documents BullMQ
 * with host + port + password + `tls: {}` instead of a rediss:// string so TLS
 * is unambiguous; we apply the same shape when the scheme is rediss.
 */
function parseRedisUrl(urlStr: string): ParsedRedisUrl {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("REDIS_URL is not a valid URL");
  }

  const isTls = u.protocol === "rediss:";
  if (!isTls && u.protocol !== "redis:") {
    throw new Error(
      "REDIS_URL must use redis:// or rediss:// (not REST or other schemes).",
    );
  }

  const port = u.port ? Number.parseInt(u.port, 10) : 6379;
  if (!Number.isFinite(port)) {
    throw new Error("REDIS_URL has an invalid port");
  }

  const host = u.hostname;
  if (!host) {
    throw new Error("REDIS_URL is missing a host");
  }

  const password =
    u.password === "" ? undefined : decodeURIComponent(u.password);
  const username =
    u.username === "" ? undefined : decodeURIComponent(u.username);

  let db: number | undefined;
  if (u.pathname && u.pathname !== "/") {
    const n = Number.parseInt(u.pathname.replace(/^\//, ""), 10);
    if (!Number.isNaN(n)) db = n;
  }

  return {
    host,
    port,
    password,
    username,
    ...(db !== undefined ? { db } : {}),
    ...(isTls ? { tls: {} as Record<string, never> } : {}),
  };
}

const sharedTcpOpts = {
  enableReadyCheck: false as const,
  keepAlive: 30_000,
  connectTimeout: 30_000,
  retryStrategy: bullMqStyleRetryStrategy,
};

function baseConnectionOptions(url: string): RedisOptions {
  validateRedisUrl(url);
  const parsed = parseRedisUrl(url);
  const family = parseFamily();

  return {
    ...parsed,
    ...sharedTcpOpts,
    ...(family !== undefined ? { family } : {}),
  };
}

/**
 * BullMQ **Queue** (API / producers): fail fast if Redis is down.
 */
export function createQueueRedis(): IORedis {
  const url = getRequiredEnv("REDIS_URL");
  const opts: RedisOptions = {
    ...baseConnectionOptions(url),
    maxRetriesPerRequest: 20,
  };
  return new IORedis(opts);
}

/**
 * BullMQ **Worker** (blocking consumption).
 *
 * Upstash (and some other managed Redis layers) can reset reads on blocking clients
 * when ioredis's default `disconnectTimeout` (2000ms) fires. BullMQ maintainers
 * and operators often set `disconnectTimeout: 0` for that combo.
 *
 * Override with `REDIS_WORKER_DISCONNECT_TIMEOUT=2000` if you use plain local Redis
 * and want the default disconnect behavior.
 */
export function createWorkerRedis(): IORedis {
  const url = getRequiredEnv("REDIS_URL");
  const disconnectTimeout = Number.parseInt(
    process.env.REDIS_WORKER_DISCONNECT_TIMEOUT ?? "0",
    10,
  );

  const opts: RedisOptions = {
    ...baseConnectionOptions(url),
    maxRetriesPerRequest: null,
    disconnectTimeout: Number.isFinite(disconnectTimeout)
      ? disconnectTimeout
      : 0,
  };

  return new IORedis(opts);
}

let miscRedis: IORedis | null = null;

/** Optional shared client for future scripts; prefer createQueueRedis in API code. */
export function getRedisConnection(): IORedis {
  miscRedis ??= createQueueRedis();
  return miscRedis;
}
