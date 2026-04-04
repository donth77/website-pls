"use client";

import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Link } from "@/i18n/navigation";

function VerifyEmailContent() {
  const t = useTranslations("VerifyEmail");
  const { update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const attempted = useRef(false);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    token ? "loading" : "error",
  );

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        setStatus(res.ok ? "success" : "error");
        if (res.ok) {
          // Refresh the JWT so emailVerified is updated and the banner disappears.
          // May fail if the user opened this link in a different browser — that's fine.
          try {
            await updateSession({});
          } catch {}
        }
      })
      .catch(() => {
        setStatus("error");
      });
  }, [token, updateSession]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm text-center">
        {status === "loading" && (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-zinc-400" />
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("verifying")}
            </h1>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("successHeading")}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t("successDescription")}
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {t("signIn")}
              </Link>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
              <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("errorHeading")}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t("errorDescription")}
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="text-sm text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {t("backToSignIn")}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
