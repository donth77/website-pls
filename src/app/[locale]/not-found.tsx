import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="text-center">
        <p className="text-6xl font-bold text-zinc-200 dark:text-zinc-800">
          {t("code")}
        </p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("heading")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("description")}
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("goHome")}
        </Link>
      </div>
    </div>
  );
}
