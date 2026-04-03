"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

interface LimitInfo {
  type: string;
  generationsRemaining: number;
  generationsMax?: number;
}

export function GenerationLimit() {
  const t = useTranslations("GenerationLimit");
  const { status } = useSession();
  const [info, setInfo] = useState<LimitInfo | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setInfo(data as LimitInfo);
      })
      .catch(() => {});
  }, [status]);

  if (!info || info.type === "user") return null;

  const remaining = info.generationsRemaining;
  const max = info.generationsMax ?? remaining;

  if (remaining >= max) return null;

  return (
    <div className="text-center text-xs text-zinc-500 dark:text-zinc-400">
      {remaining > 0 ? (
        <span>
          {t("remaining", { remaining, max })}{" "}
          <Link
            href="/login"
            className="underline transition hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {t("signInMore")}
          </Link>{" "}
          {t("forMore")}
        </span>
      ) : (
        <span>
          {t("noFreeLeft")}{" "}
          <Link
            href="/login"
            className="underline transition hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {t("signInMore")}
          </Link>{" "}
          {t("toContinue")}
        </span>
      )}
    </div>
  );
}
