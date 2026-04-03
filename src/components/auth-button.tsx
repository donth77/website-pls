"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { LogIn, LogOut, User, FolderOpen, Coins } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function AuthButton() {
  const t = useTranslations("Auth");
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch credits when menu opens.
  useEffect(() => {
    if (!isOpen || !session) return;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.generationsRemaining != null) {
          setCredits(data.generationsRemaining);
        }
      })
      .catch(() => {});
  }, [isOpen, session]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (status === "loading") {
    return (
      <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
    );
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => signIn()}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        <LogIn className="h-3.5 w-3.5" />
        {t("signIn")}
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
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
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {session.user?.name ?? t("user")}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {session.user?.email}
            </p>
          </div>

          {credits !== null && (
            <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {t("credit", { count: credits })}
              </span>
            </div>
          )}

          <Link
            href="/projects"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => setIsOpen(false)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("myProjects")}
          </Link>

          <button
            type="button"
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
