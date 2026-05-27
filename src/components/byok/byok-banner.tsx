"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@ariakit/react";
import { useByok, type ByokPromptReason } from "@/lib/byok/context";

const COPY: Record<
  ByokPromptReason,
  { headline: string; sub: string; cta: string }
> = {
  "platform-budget-low": {
    headline: "Free generations are temporarily unavailable.",
    sub: "Add your own Anthropic API key to keep generating — your key stays in this browser.",
    cta: "Add your key",
  },
  "user-cap": {
    headline: "You've used your free generations.",
    sub: "Add your own Anthropic API key for unlimited generations — your key stays in this browser.",
    cta: "Use your own key",
  },
  "rate-limit": {
    headline: "Too many requests in the last hour.",
    sub: "Wait an hour, or add your own Anthropic API key to keep generating now.",
    cta: "Use your own key",
  },
};

/**
 * Single banner with three reasons:
 *   - platform-budget-low : platform key 429
 *   - user-cap            : GENERATION_LIMIT (guest cap or user credits gone)
 *   - rate-limit          : per-hour RATE_LIMIT hit
 *
 * Renders nothing without a reason or when the user already has a key —
 * once they're on the BYOK path, the banner becomes noise.
 */
export function ByokBanner() {
  const { promptReason, status, openModal, setPromptReason } = useByok();

  const hasKey = status !== "none";
  if (!promptReason || hasKey) return null;

  const copy = COPY[promptReason];

  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="flex-1">
        <p className="text-amber-900 dark:text-amber-200">{copy.headline}</p>
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
          {copy.sub}
        </p>
        <div className="mt-2">
          <Button
            onClick={openModal}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            {copy.cta}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPromptReason(null)}
        className="rounded-lg p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
