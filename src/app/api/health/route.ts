import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRedisConnection } from "@/lib/queue/redis";
import Anthropic from "@anthropic-ai/sdk";

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

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

async function checkAnthropic(): Promise<CheckResult> {
  const start = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, latencyMs: 0, error: "ANTHROPIC_API_KEY not set" };
  }
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

/**
 * GET /api/health          → { ok: true } (shallow, for load balancers)
 * GET /api/health?deep=true → checks DB, Redis, Anthropic with latencies
 */
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "true";

  if (!deep) {
    return NextResponse.json({ ok: true });
  }

  const [db, redis, anthropic] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkAnthropic(),
  ]);

  const allOk = db.ok && redis.ok && anthropic.ok;

  return NextResponse.json(
    { ok: allOk, checks: { db, redis, anthropic } },
    { status: allOk ? 200 : 503 },
  );
}
