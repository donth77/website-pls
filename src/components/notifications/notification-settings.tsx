"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@ariakit/react";
import { useTranslations } from "next-intl";
import {
  getPermission,
  requestPermission,
  type NotificationPermissionState,
} from "@/lib/notifications/desktop";
import { loadOptIn, saveOptIn } from "@/lib/notifications/preference";

/**
 * Settings-page notification controls. Self-contained: reads and writes
 * the same localStorage preference + browser permission that
 * use-generation observes. No cross-page state sync needed — the
 * generator hydrates from localStorage on next mount.
 */
export function NotificationSettings() {
  const t = useTranslations("Notify");
  const [permission, setPermission] =
    useState<NotificationPermissionState>("default");
  const [optedIn, setOptedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hydrate from browser + localStorage on mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPermission(getPermission());
    setOptedIn(loadOptIn());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function handleEnable() {
    setBusy(true);
    const result = await requestPermission();
    setPermission(result);
    if (result === "granted") {
      saveOptIn(true);
      setOptedIn(true);
    }
    setBusy(false);
  }

  function handleDisable() {
    saveOptIn(false);
    setOptedIn(false);
  }

  if (permission === "unsupported") {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("unsupported")}
      </p>
    );
  }

  const isOn = optedIn && permission === "granted";

  return (
    <div>
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          {isOn ? (
            <Bell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <BellOff className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
          )}
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {isOn ? t("settingsStatusOn") : t("settingsStatusOff")}
          </span>
        </div>
        {isOn ? (
          <button
            type="button"
            onClick={handleDisable}
            className="rounded-lg border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("settingsTurnOff")}
          </button>
        ) : (
          <Button
            onClick={handleEnable}
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? t("enabling") : t("settingsTurnOn")}
          </Button>
        )}
      </div>
      {permission === "denied" && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t("blockedHint")}
        </p>
      )}
    </div>
  );
}
