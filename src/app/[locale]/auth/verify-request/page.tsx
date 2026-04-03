import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function VerifyRequestPage() {
  const t = useTranslations("VerifyEmail");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
          <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("heading")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("description")}
        </p>

        <div className="mt-8">
          <Link
            href="/login"
            className="text-sm text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
