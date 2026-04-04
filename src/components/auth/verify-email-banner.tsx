"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import { Button } from "@ariakit/react";
import { toast } from "sonner";

export function VerifyEmailBanner() {
  const t = useTranslations("VerifyBanner");
  const { data: session, update: updateSession } = useSession();
  const [sending, setSending] = useState(false);

  // Refresh the session on mount and when the user tabs back, in case they
  // verified in another tab.
  useEffect(() => {
    if (!session?.user || session.user.emailVerified) return;

    updateSession({});

    function onVisible() {
      if (document.visibilityState === "visible") {
        updateSession({});
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't show if no session, already verified, or OAuth user (verified by default).
  if (!session?.user || session.user.emailVerified) return null;

  async function handleResend() {
    setSending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
      });
      if (res.ok) {
        toast.success(t("sent"));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t("sendError"));
      }
    } catch {
      toast.error(t("sendError"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <Mail className="h-4 w-4 shrink-0" />
      <p>
        {t("message")}{" "}
        <Button
          onClick={handleResend}
          disabled={sending}
          className="font-medium underline hover:no-underline aria-disabled:opacity-50"
        >
          {sending ? t("sending") : t("resend")}
        </Button>
      </p>
    </div>
  );
}
