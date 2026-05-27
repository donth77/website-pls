"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@ariakit/react";
import { useByok } from "@/lib/byok/context";

/**
 * Shown when the server reports PLATFORM_BUDGET_LOW (free generations
 * temporarily unavailable). Disappears automatically once a key is saved
 * (savePlain/saveEncrypted clear `budgetLow`) or when the user dismisses it.
 *
 * Renders nothing when there's nothing to show — safe to mount permanently.
 */
export function ByokBanner() {
  const { budgetLow, status, openModal, clearBudgetLow } = useByok();

  // Once the user has a key (active or locked), they're already on the BYOK
  // path; the banner becomes noise.
  const hasKey = status !== "none";
  if (!budgetLow || hasKey) return null;

  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="flex-1">
        <p className="text-amber-900 dark:text-amber-200">
          Free generations are temporarily unavailable.
        </p>
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
          Add your own Anthropic API key to keep generating — your key stays in
          this browser.
        </p>
        <div className="mt-2">
          <Button
            onClick={openModal}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            Add your key
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={clearBudgetLow}
        className="rounded-lg p-1 text-amber-700 transition hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
