"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export function BackButton() {
  const t = useTranslations("Common");
  const router = useRouter();

  return (
    // Mobile: a full-width solid bar pinned directly under the 48px global
    // header (top-12 = 48px) so the link never visually collides with the page
    // heading. Desktop (sm+): a floating, transparent inline link.
    <div className="fixed top-12 z-40 max-sm:inset-x-0 max-sm:border-b max-sm:border-zinc-200 max-sm:bg-white max-sm:px-4 max-sm:py-2.5 sm:top-16 sm:left-6 max-sm:dark:border-zinc-800 max-sm:dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back")}
      </button>
    </div>
  );
}
