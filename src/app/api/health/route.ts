import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getRedisConnection } from "@/lib/queue/redis";

type CheckResult = { ok: boolean; latencyMs: number; error?: string };
type PublicCheckResult = { ok: boolean; error?: string };

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const redis = getRedisConnection();
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

function checkAnthropicKey(): CheckResult {
  const ok = !!process.env.ANTHROPIC_API_KEY?.trim();
  return {
    ok,
    latencyMs: 0,
    ...(ok ? {} : { error: "ANTHROPIC_API_KEY not set" }),
  };
}

/** Strip latency and error details from public responses. */
function redact(check: CheckResult): PublicCheckResult {
  return { ok: check.ok, ...(check.ok ? {} : { error: "unavailable" }) };
}

/**
 * Verify the admin Bearer token (reuses CLEANUP_SECRET as a general admin key).
 * Returns true if the token matches.
 */
function isAdminAuthorized(req: NextRequest): boolean {
  const secret = process.env.CLEANUP_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  return (
    authBuf.length === expectedBuf.length &&
    timingSafeEqual(authBuf, expectedBuf)
  );
}

/**
 * GET /api/health          → { ok: true } (shallow, for load balancers)
 * GET /api/health?deep=true → checks DB, Redis, Anthropic key (requires admin Bearer token)
 */
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "true";

  if (!deep) {
    return NextResponse.json({ ok: true });
  }

  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const anthropic = checkAnthropicKey();

  const allOk = db.ok && redis.ok && anthropic.ok;

  return NextResponse.json(
    {
      ok: allOk,
      checks: {
        db: redact(db),
        redis: redact(redis),
        anthropic: redact(anthropic),
      },
    },
    { status: allOk ? 200 : 503 },
  );
}
