import { createLogger } from "@/lib/logger";

const log = createLogger("turnstile");
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 10_000;

if (!process.env.TURNSTILE_SECRET_KEY?.trim()) {
  log.warn(
    "TURNSTILE_SECRET_KEY is not set — Turnstile verification is DISABLED. Set it in .env before deploying to production.",
  );
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string; code: "TURNSTILE" };

export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  // Skip verification when secret is not configured (local dev).
  if (!secret) {
    return { ok: true };
  }

  if (!token?.trim()) {
    return {
      ok: false,
      httpStatus: 400,
      message: "Missing Turnstile verification token.",
      code: "TURNSTILE",
    };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: ac.signal,
    });

    if (!res.ok) {
      log.error(
        "Turnstile fail-open: siteverify HTTP error, allowing request through",
        { status: res.status },
      );
      return { ok: true };
    }

    const json = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };

    if (!json.success) {
      log.warn("Turnstile verification failed", {
        errors: json["error-codes"],
      });
      return {
        ok: false,
        httpStatus: 403,
        message: "Bot verification failed. Please try again.",
        code: "TURNSTILE",
      };
    }

    return { ok: true };
  } catch (err) {
    log.error(
      "Turnstile fail-open: siteverify request failed, allowing request through",
      { error: String(err) },
    );
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
