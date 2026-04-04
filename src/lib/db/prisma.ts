import "dotenv/config";
import dns from "node:dns";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Neon’s pooled hostname (`-pooler.`) suits short-lived serverless connects.
 * Local Next + long-lived `pg.Pool` + worker often stalls until connect timeout.
 * Use the direct compute host in dev unless opted in.
 */
function applyNeonDevDirectConnectionString(raw: string): string {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DATABASE_USE_NEON_POOLER === "true"
  ) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes("-pooler.")) {
      parsed.hostname = parsed.hostname.replace("-pooler.", ".");
      return parsed.toString();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

// pg 8.20+ with Neon hostnames fails to connect by hostname even when
// dns.setDefaultResultOrder("ipv4first") is set. Work around this by
// resolving the hostname to an IPv4 address ourselves and passing the
// IP as `host` with the original hostname as `ssl.servername` (SNI).
async function resolvePoolConfig(connectionString: string) {
  const url = new URL(connectionString);
  const hostname = url.hostname;
  const poolMax =
    process.env.NODE_ENV === "production"
      ? parseInt(process.env.DATABASE_POOL_MAX ?? "15", 10)
      : parseInt(process.env.DATABASE_POOL_MAX ?? "3", 10);
  const connectionTimeoutMillis = parseInt(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "30000",
    10,
  );

  let host = hostname;
  try {
    const addrs = await dns.promises.resolve4(hostname);
    if (addrs.length > 0) host = addrs[0];
  } catch {
    // Fall back to hostname if DNS resolution fails
  }

  return new pg.Pool({
    host,
    port: parseInt(url.port || "5432"),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1) || "postgres",
    ssl: { rejectUnauthorized: false, servername: hostname },
    max: poolMax,
    connectionTimeoutMillis,
    keepAlive: true,
    statement_timeout: 10_000,
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReady: Promise<PrismaClient> | undefined;
};

async function createPrismaClient(): Promise<PrismaClient> {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set");
  }

  const connectionString = applyNeonDevDirectConnectionString(raw);
  const pool = await resolvePoolConfig(connectionString);
  return new PrismaClient({
    // pnpm can surface two @types/pg copies; runtime Pool is compatible.
    adapter: new PrismaPg(pool as never),
  });
}

function getPrisma(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) return Promise.resolve(globalForPrisma.prisma);
  if (!globalForPrisma.prismaReady) {
    globalForPrisma.prismaReady = createPrismaClient().then((client) => {
      globalForPrisma.prisma = client;
      return client;
    });
  }
  return globalForPrisma.prismaReady;
}

// Eager-start the async initialization.
const prismaPromise = getPrisma();

// Proxy that lazily awaits the real PrismaClient on first use.
// This preserves the synchronous `export const prisma` API so every
// existing import continues to work without adding `await` everywhere.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // Allow sync access if already resolved.
    if (globalForPrisma.prisma) {
      return (
        globalForPrisma.prisma as unknown as Record<string | symbol, unknown>
      )[prop];
    }
    // For model accessors (user, account, project, …) and $-prefixed
    // methods ($connect, $disconnect, $transaction, …), return a wrapper
    // that awaits initialization first.
    return new Proxy(function () {}, {
      get(_t, subProp) {
        return (...args: unknown[]) =>
          prismaPromise.then((client) => {
            const model = (
              client as unknown as Record<string | symbol, unknown>
            )[prop];
            return (
              model as Record<string | symbol, (...a: unknown[]) => unknown>
            )[subProp](...args);
          });
      },
      apply(_t, _thisArg, args) {
        return prismaPromise.then((client) =>
          (
            client as unknown as Record<
              string | symbol,
              (...a: unknown[]) => unknown
            >
          )[prop](...args),
        );
      },
    });
  },
});
