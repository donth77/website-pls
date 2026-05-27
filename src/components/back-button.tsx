"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export function BackButton() {
  const t = useTranslations("Common");
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      // Anchor below the 48px global header (top-16 = 64px → 16px clearance).
      className="fixed top-16 left-4 z-40 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-700 sm:left-6 dark:text-zinc-400 dark:hover:text-zinc-200"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {t("back")}
    </button>
  );
}
