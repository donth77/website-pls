"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@ariakit/react";
import { useTranslations } from "next-intl";
import { useByok, type ByokPromptReason } from "@/lib/byok/context";

/**
 * Single banner with three reasons. Translation keys follow the
 * pattern `banner{Reason}{Headline|Sub|Cta}` so swapping the reason
 * picks all three pieces of copy without a Record lookup.
 *
 * Renders nothing without a reason or when the user already has a key —
 * once they're on the BYOK path, the banner becomes noise.
 */
export function ByokBanner() {
  const t = useTranslations("Byok");
  const { promptReason, status, openModal, setPromptReason } = useByok();

  const hasKey = status !== "none";
  if (!promptReason || hasKey) return null;

  const camel = REASON_TO_CAMEL[promptReason];

  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="flex-1">
        <p className="text-amber-900 dark:text-amber-200">
          {t(`banner${camel}Headline`)}
        </p>
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
          {t(`banner${camel}Sub`)}
        </p>
        <div className="mt-2">
          <Button
            onClick={openModal}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            {t(`banner${camel}Cta`)}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPromptReason(null)}
        className="rounded-lg p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
        aria-label={t("bannerDismiss")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const REASON_TO_CAMEL: Record<ByokPromptReason, string> = {
  "platform-budget-low": "PlatformBudgetLow",
  "user-cap": "UserCap",
  "rate-limit": "RateLimit",
};
