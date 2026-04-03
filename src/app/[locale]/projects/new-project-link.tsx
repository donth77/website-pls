"use client";

import { Button } from "@ariakit/react";
import { useRouter } from "@/i18n/navigation";
import { SESSION_KEY } from "@/hooks/use-generation";

export function NewProjectLink({ label }: { label: string }) {
  const router = useRouter();

  function handleClick() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    router.push("/");
  }

  return (
    <Button
      onClick={handleClick}
      className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {label}
    </Button>
  );
}
