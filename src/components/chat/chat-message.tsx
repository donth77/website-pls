import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@ariakit/react";
import type { ChatMessage } from "@/lib/types";
import { formatElapsed } from "@/lib/types";

export interface ChatMessageProps {
  message: ChatMessage;
  /** The timestamp of the user message that triggered this assistant response. */
  userTimestamp?: number;
  /** Timestamp of the previous message (any role) — used to suppress duplicate timestamps. */
  prevTimestamp?: number;
  elapsedSeconds: number;
  isSubmitting: boolean;
  isLatestAssistant: boolean;
  onRetry: () => void;
}

function formatTimestamp(ts: number, locale?: string): string {
  return new Date(ts).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(ts: number, locale?: string): string {
  const now = new Date();
  const date = new Date(ts);
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return formatTimestamp(ts, locale);
  }

  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChatMessageBubble({
  message,
  userTimestamp,
  prevTimestamp,
  elapsedSeconds,
  isSubmitting,
  isLatestAssistant,
  onRetry,
}: ChatMessageProps) {
  const t = useTranslations("Message");
  const tProgress = useTranslations("Progress");

  if (message.role === "user") {
    // Suppress timestamp if same minute as the previous message
    const sameMinute =
      prevTimestamp &&
      message.timestamp &&
      Math.floor(prevTimestamp / 60000) ===
        Math.floor(message.timestamp / 60000);

    return (
      <div>
        {message.timestamp > 0 && !sameMinute && (
          <p className="mb-1.5 text-center text-[10px] text-zinc-400 dark:text-zinc-500">
            {formatDate(message.timestamp)}
          </p>
        )}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white dark:bg-zinc-100 dark:text-zinc-900">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // "Thought for Xs" — only shown after generation completes
  const thoughtSeconds =
    userTimestamp && message.timestamp && message.status !== "GENERATING"
      ? Math.round((message.timestamp - userTimestamp) / 1000)
      : 0;

  return (
    <div>
      {thoughtSeconds > 0 && (
        <p className="mb-1.5 text-xs text-zinc-400 dark:text-zinc-500">
          {t("thoughtFor", { time: formatElapsed(thoughtSeconds) })}
        </p>
      )}
      <div className="flex items-start gap-2.5">
        {isLatestAssistant && message.status === "GENERATING" && (
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600"
            aria-hidden="true"
          >
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {message.status === "GENERATING" ? (
            <div role="status" aria-live="polite">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {message.progressStep
                  ? tProgress.has(message.progressStep)
                    ? tProgress(message.progressStep)
                    : message.progressStep
                  : tProgress("starting")}
                {elapsedSeconds > 0 && (
                  <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {formatElapsed(elapsedSeconds)}
                  </span>
                )}
              </p>
              <div
                className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                role="progressbar"
                aria-valuenow={message.progressPercent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("progressLabel")}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-700 ease-out"
                  style={{ width: `${message.progressPercent ?? 0}%` }}
                />
              </div>
            </div>
          ) : message.status === "ERROR" ? (
            <div role="alert">
              <p className="text-sm text-red-600 dark:text-red-400">
                {message.content}
              </p>
              <Button
                className="mt-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 aria-disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                onClick={onRetry}
                disabled={isSubmitting}
              >
                {t("tryAgain")}
              </Button>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {message.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
