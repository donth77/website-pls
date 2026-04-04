import { useTranslations } from "next-intl";

export default function PrivacyPage() {
  const t = useTranslations("Privacy");

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("heading")}
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t("lastUpdated")}
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>{t("placeholder")}</p>
      </div>
    </div>
  );
}
