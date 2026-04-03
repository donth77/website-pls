"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { LogIn, LogOut, User, FolderOpen, Coins } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Button,
  MenuProvider,
  MenuButton,
  Menu,
  MenuItem,
} from "@ariakit/react";

export function AuthButton() {
  const t = useTranslations("Auth");
  const { data: session, status } = useSession();
  const [credits, setCredits] = useState<number | null>(null);
  const [creditsLoaded, setCreditsLoaded] = useState(false);

  // Fetch credits as soon as we have a session (not on menu open).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.generationsRemaining != null) {
          setCredits(data.generationsRemaining);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCreditsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (status === "loading") {
    return (
      <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
    );
  }

  if (!session) {
    return (
      <Button
        onClick={() => signIn()}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        <LogIn className="h-3.5 w-3.5" />
        {t("signIn")}
      </Button>
    );
  }

  return (
    <MenuProvider>
      <MenuButton
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 transition hover:ring-2 hover:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:ring-zinc-600"
        aria-label={t("accountMenu")}
      >
        {session.user?.image ? (
          <img
            src={session.user.image}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <User className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        )}
      </MenuButton>

      <Menu
        gutter={8}
        placement="bottom-end"
        className="z-50 w-64 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <p className="truncate text-base font-medium text-zinc-900 dark:text-zinc-100">
            {session.user?.name ?? t("user")}
          </p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            {session.user?.email}
          </p>
        </div>

        {!creditsLoaded ? (
          <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <Coins className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
            <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ) : credits !== null ? (
          <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <Coins className="h-4 w-4 text-amber-500" />
            <span className="text-base text-zinc-700 dark:text-zinc-300">
              {t("credit", { count: credits })}
            </span>
          </div>
        ) : null}

        <MenuItem
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-base text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          render={<Link href="/projects" />}
        >
          <FolderOpen className="h-4 w-4" />
          {t("myProjects")}
        </MenuItem>

        <MenuItem
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-base text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          {t("signOut")}
        </MenuItem>
      </Menu>
    </MenuProvider>
  );
}
