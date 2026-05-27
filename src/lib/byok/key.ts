import Anthropic from "@anthropic-ai/sdk";

const KEY_PREFIX = "sk-ant-";
const MIN_KEY_LEN = 30;
const MAX_KEY_LEN = 200;

/**
 * Cheap structural check. Catches the most common mistakes (empty, wrong
 * provider, accidentally pasted noise) without contacting Anthropic.
 */
export function validateApiKeyFormat(raw: unknown): {
  ok: boolean;
  reason?: string;
} {
  if (typeof raw !== "string") {
    return { ok: false, reason: "API key must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "API key is empty." };
  }
  if (!trimmed.startsWith(KEY_PREFIX)) {
    return { ok: false, reason: "API key must start with 'sk-ant-'." };
  }
  if (trimmed.length < MIN_KEY_LEN || trimmed.length > MAX_KEY_LEN) {
    return { ok: false, reason: "API key has an unexpected length." };
  }
  // Anthropic keys are URL-safe base64-ish; reject obvious garbage like
  // newlines or shell metacharacters that wouldn't survive an HTTP header.
  if (!/^[A-Za-z0-9_\-.]+$/.test(trimmed)) {
    return { ok: false, reason: "API key contains invalid characters." };
  }
  return { ok: true };
}

/**
 * Confirms the key actually works against Anthropic before we enqueue a job.
 * Uses `models.list({ limit: 1 })` — a no-cost authenticated GET — instead of
 * a Messages call so we don't burn tokens just to validate.
 */
export async function testApiKey(apiKey: string): Promise<{
  ok: boolean;
  status?: number;
  reason?: string;
}> {
  try {
    const client = new Anthropic({ apiKey });
    await client.models.list({ limit: 1 });
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
