"use client";

import { SESSION_KEY } from "@/hooks/use-generation";
import { AuthButton } from "./auth/auth-button";

export function GlobalBar() {
  function handleLogoClick(e: React.MouseEvent) {
    e.preventDefault();
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    window.location.href = "/";
  }

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <a
        href="/"
        onClick={handleLogoClick}
        className="text-sm font-semibold text-zinc-800 transition hover:text-zinc-600 dark:text-zinc-200 dark:hover:text-zinc-400"
      >
        WebsitePls
      </a>
      <AuthButton />
    </header>
  );
}
