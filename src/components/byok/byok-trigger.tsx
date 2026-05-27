"use client";

import { Key, Lock } from "lucide-react";
import { Button } from "@ariakit/react";
import { useByok } from "@/lib/byok/context";

/**
 * Sidebar header trigger. Doubles as the BYOK status indicator: a small
 * coloured dot shows whether a key is active, locked, or absent.
 */
export function ByokTrigger() {
  const { status, openModal } = useByok();

  const isActive = status === "plain" || status === "encrypted-unlocked";
  const isLocked = status === "encrypted-locked";

  const label = isActive
    ? "Using your Anthropic key"
    : isLocked
      ? "Unlock your Anthropic key"
      : "Use your own Anthropic key";

  return (
    <Button
      onClick={openModal}
      className={`relative rounded-lg p-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        isActive
          ? "text-zinc-700 dark:text-zinc-200"
          : "text-zinc-400 dark:text-zinc-500"
      }`}
      aria-label={label}
      title={label}
    >
      {isLocked ? (
        <Lock className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Key className="h-4 w-4" aria-hidden="true" />
      )}
      {isActive && (
        <span
          className="absolute top-1 right-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
      )}
      {isLocked && (
        <span
          className="absolute top-1 right-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
          aria-hidden="true"
        />
      )}
    </Button>
  );
}
