import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { PROVIDER_META, type Provider } from "./providers";

const MIN_KEY_LEN = 20;
const MAX_KEY_LEN = 200;

const VALID_KEY_RE = /^[A-Za-z0-9_\-.]+$/;

/**
 * Cheap structural check. Catches the most common mistakes (empty, wrong
 * provider prefix, accidentally pasted noise) without contacting the
 * provider's servers.
 *
 * The `provider` arg defaults to "anthropic" so any legacy callers that
 * haven't been migrated yet still validate against Anthropic's prefix.
 */
export function validateApiKeyFormat(
  raw: unknown,
  provider: Provider = "anthropic",
): { ok: boolean; reason?: string } {
  if (typeof raw !== "string") {
    return { ok: false, reason: "API key must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "API key is empty." };
  }
  const prefix = PROVIDER_META[provider].keyPrefix;
  if (!trimmed.startsWith(prefix)) {
    return {
      ok: false,
      reason: `${PROVIDER_META[provider].label} keys start with '${prefix}'.`,
    };
  }
  if (trimmed.length < MIN_KEY_LEN || trimmed.length > MAX_KEY_LEN) {
    return { ok: false, reason: "API key has an unexpected length." };
  }
  if (!VALID_KEY_RE.test(trimmed)) {
    return { ok: false, reason: "API key contains invalid characters." };
  }
  return { ok: true };
}

/**
 * Live-test a key against the provider's cheapest authenticated endpoint:
 *   - Anthropic:  models.list({ limit: 1 })   — no token spend
 *   - OpenAI:     models.list()               — no token spend
 *   - OpenRouter: GET /api/v1/auth/key        — returns key info
 *
 * Wrapped errors expose the upstream HTTP status so the API route can map
 * 401 → BYOK_INVALID vs. other codes → generic failure.
 */
export async function testApiKey(
  apiKey: string,
  provider: Provider = "anthropic",
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      await client.models.list({ limit: 1 });
      return { ok: true };
    }
    if (provider === "openai") {
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return { ok: true };
    }
    // OpenRouter: bypass the OpenAI SDK so the failure message is the
    // OpenRouter-specific one instead of a confusing OpenAI-shaped error.
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: `OpenRouter rejected the key (HTTP ${res.status}).`,
      };
    }
    return { ok: true };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return {
      ok: false,
      status: e.status,
      reason: e.message ?? "API key validation failed.",
    };
  }
}
