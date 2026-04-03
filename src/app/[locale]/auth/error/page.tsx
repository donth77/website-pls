"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const ERROR_KEYS: Record<string, string> = {
  Configuration: "configuration",
  AccessDenied: "accessDenied",
  Verification: "verification",
  OAuthSignin: "oauthSignin",
  OAuthCallback: "oauthCallback",
  OAuthAccountNotLinked: "oauthAccountNotLinked",
  Default: "default",
};

function AuthErrorContent() {
  const t = useTranslations("AuthError");
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? "Default";
  const key = ERROR_KEYS[errorCode] ?? ERROR_KEYS.Default;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t(`${key}_title`)}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t(`${key}_description`)}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("backToSignIn")}
          </Link>
          <Link
            href="/"
            className="text-sm text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {t("goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  );
}
