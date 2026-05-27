/**
 * Lakera Guard — optional pre-LLM screening for prompt-injection / abuse.
 * https://docs.lakera.ai/docs/api/guard
 *
 * If LAKERA_API_KEY is unset, screening is skipped (local dev).
 */

import { createLogger } from "@/lib/logger";
import { ErrorCode } from "@/lib/types";

const log = createLogger("lakera");
const DEFAULT_BASE = "https://api.lakera.ai";
const TIMEOUT_MS = 15_000;

// Screening is required unless NODE_ENV is explicitly "development" or "test".
// Anything else (including unset or misconfigured NODE_ENV) is treated as
// production — failing closed avoids accidentally shipping a build that
// bypasses screening because NODE_ENV wasn't set to what we expected.
if (!process.env.LAKERA_API_KEY?.trim()) {
  const nodeEnv = process.env.NODE_ENV;
  const isDevOrTest = nodeEnv === "development" || nodeEnv === "test";
  if (!isDevOrTest) {
    throw new Error(
      `LAKERA_API_KEY is not set. Prompt screening cannot be disabled outside development/test (NODE_ENV=${nodeEnv ?? "unset"}).`,
    );
  }
  log.warn(
    "LAKERA_API_KEY is not set — prompt screening is DISABLED. Set it in .env before deploying.",
  );
}

/** Re-export the subset of ErrorCode used by Lakera for type narrowing. */
export const LakeraErrorCode = {
  PROMPT_BLOCKED: ErrorCode.PROMPT_BLOCKED,
  RATE_LIMIT: ErrorCode.RATE_LIMIT,
  SCREENING_UNAVAILABLE: ErrorCode.SCREENING_UNAVAILABLE,
  SCREENING_CONFIG: ErrorCode.SCREENING_CONFIG,
} as const;

export type LakeraScreenResult =
  | { ok: true; skipped?: boolean }
  | {
      ok: false;
      httpStatus: number;
      message: string;
      code: (typeof LakeraErrorCode)[keyof typeof LakeraErrorCode];
    };

function lakeraBaseUrl(): string {
  const raw = process.env.LAKERA_API_URL?.trim();
  if (!raw) return DEFAULT_BASE;
  return raw.replace(/\/$/, "");
}

/** Optional IPv4 for Lakera metadata (schema prefers ipv4). */
function clientIpv4(forwarded: string | null): string | undefined {
  if (!forwarded) return undefined;
  const first = forwarded.split(",")[0]?.trim() ?? "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(first)) return first;
  return undefined;
}

/**
 * Screen raw user website brief. Send the same text the user typed (no delimiter wrappers),
 * per Lakera input-screening guidance.
 */
export async function screenUserPromptWithLakera(
  userPrompt: string,
  meta?: { forwardedFor?: string | null },
): Promise<LakeraScreenResult> {
  const apiKey = process.env.LAKERA_API_KEY?.trim();
  if (!apiKey) {
    return { ok: true, skipped: true };
  }

  const projectId = process.env.LAKERA_PROJECT_ID?.trim();
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: userPrompt }],
  };

  if (projectId) {
    body.project_id = projectId;
  }

  const ip = clientIpv4(meta?.forwardedFor ?? null);
  if (ip) {
    body.metadata = {
      ip_address: ip,
      internal_request_id: crypto.randomUUID(),
    };
  } else {
    body.metadata = { internal_request_id: crypto.randomUUID() };
  }

  const url = `${lakeraBaseUrl()}/v2/guard`;
  let res: Response;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    log.error("Request failed", { error: String(e) });
    return {
      ok: false,
      httpStatus: 503,
      code: LakeraErrorCode.SCREENING_UNAVAILABLE,
      message:
        "Security screening is temporarily unavailable. Please try again.",
    };
  } finally {
    clearTimeout(t);
  }

  if (res.status === 429) {
    return {
      ok: false,
      httpStatus: 429,
      code: LakeraErrorCode.RATE_LIMIT,
      message: "Too many requests. Please try again in a moment.",
    };
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    log.error("API error", { status: res.status, body: errBody.slice(0, 500) });
    if (res.status === 401) {
      return {
        ok: false,
        httpStatus: 500,
        code: LakeraErrorCode.SCREENING_CONFIG,
        message: "Server configuration error.",
      };
    }
    return {
      ok: false,
      httpStatus: 503,
      code: LakeraErrorCode.SCREENING_UNAVAILABLE,
      message:
        "Security screening is temporarily unavailable. Please try again.",
    };
  }

  let json: { flagged?: boolean };
  try {
    json = (await res.json()) as { flagged?: boolean };
  } catch {
    return {
      ok: false,
      httpStatus: 503,
      code: LakeraErrorCode.SCREENING_UNAVAILABLE,
      message:
        "Security screening returned an invalid response. Please try again.",
    };
  }

  if (json.flagged === true) {
    return {
      ok: false,
      httpStatus: 400,
      code: LakeraErrorCode.PROMPT_BLOCKED,
      message:
        "This prompt couldn’t be accepted by our safety filter. Try describing your website in different words.",
    };
  }

  return { ok: true };
}
