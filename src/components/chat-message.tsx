import { Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { formatElapsed } from "@/lib/types";

export interface ChatMessageProps {
  message: ChatMessage;
  elapsedSeconds: number;
  isSubmitting: boolean;
  onRetry: () => void;
}

export function ChatMessageBubble({
  message,
  elapsedSeconds,
  isSubmitting,
  onRetry,
}: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white dark:bg-zinc-100 dark:text-zinc-900">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600"
        aria-hidden="true"
      >
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {message.status === "GENERATING" ? (
          <div role="status" aria-live="polite">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {message.progressStep ?? "Starting\u2026"}
              {elapsedSeconds > 0 && (
                <span className="ml-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">
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
              aria-label="Generation progress"
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
            <button
              type="button"
              className="mt-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
              onClick={onRetry}
              disabled={isSubmitting}
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {message.content}
          </p>
        )}
      </div>
    </div>
  );
}
