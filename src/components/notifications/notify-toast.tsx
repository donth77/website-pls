"use client";

import { Bell, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@ariakit/react";
import { useTranslations } from "next-intl";

interface NotifyToastProps {
  onEnable: () => Promise<{ ok: boolean; reason?: string }>;
  onDismiss: () => void;
}

/**
 * Compact bar shown above the chat input after ~30s of GENERATING.
 * Asks the user if they want a desktop notification when the run finishes.
 * Hidden by the parent (`showNotifyPrompt` derived state) — no own visibility logic.
 */
export function NotifyToast({ onEnable, onDismiss }: NotifyToastProps) {
  const t = useTranslations("Notify");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    const result = await onEnable();
    setBusy(false);
    if (!result.ok && result.reason) {
      setError(result.reason);
    }
  }

  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/30">
      <Bell
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400"
        aria-hidden="true"
      />
      <div className="flex-1">
        <p className="text-indigo-900 dark:text-indigo-200">{t("prompt")}</p>
        {error && (
          <p className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          onClick={handleEnable}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700 aria-disabled:opacity-50"
        >
          {busy ? t("enabling") : t("enable")}
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-indigo-700 transition hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
          aria-label={t("dismiss")}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
