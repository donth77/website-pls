"use client";

import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@ariakit/react";
import { Mail } from "lucide-react";
import { Link } from "@/i18n/navigation";

function ForgotPasswordForm() {
  const t = useTranslations("ForgotPassword");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setIsLoading(true);

    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Always show success to prevent email enumeration
    setSent(true);
    setIsLoading(false);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
              <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t("sentHeading")}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t("sentDescription")}
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
        ) : (
          <>
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t("heading")}
              </h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t("description")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {t("emailLabel")}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  required
                  autoComplete="email"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || !email.trim()}
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 aria-disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {isLoading ? t("sending") : t("sendResetLink")}
              </Button>
            </form>

            <div className="mt-6 text-center">
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

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
