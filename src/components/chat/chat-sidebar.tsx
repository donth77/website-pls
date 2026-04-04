import { ArrowUp, CircleHelp, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@ariakit/react";
import { ChatMessageBubble } from "./chat-message";
import type { ChatMessage, GenerationStatus } from "@/lib/types";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";

export interface ChatSidebarProps {
  messages: ChatMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  canSubmit: boolean;
  status: GenerationStatus;
  isSubmitting: boolean;
  projectName: string | null;
  versionNumber: number;
  elapsedSeconds: number;
  onNewProject: () => void;
  onInfoOpen: () => void;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  sidebarInputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatSidebar({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  onRetry,
  canSubmit,
  status,
  isSubmitting,
  projectName,
  versionNumber,
  elapsedSeconds,
  onNewProject,
  onInfoOpen,
  onToggleSidebar,
  isSidebarCollapsed,
  messagesEndRef,
  sidebarInputRef,
}: ChatSidebarProps) {
  const t = useTranslations("Chat");

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — between messages and input on mobile, top on desktop */}
      <div className="order-2 flex shrink-0 items-center justify-between border-t border-zinc-200 px-4 py-3 md:order-none md:border-t-0 md:border-b dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {projectName && (
            <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {projectName}
            </span>
          )}
          {projectName && versionNumber > 0 && (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              v{versionNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* <Button
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={onInfoOpen}
            aria-label={t("about")}
          >
            <CircleHelp className="h-4 w-4" />
          </Button> */}
          <Button
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={onNewProject}
            aria-label={t("newProject")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("new")}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="order-1 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:order-none"
        role="log"
        aria-label={t("messagesLabel")}
        aria-live="polite"
      >
        {messages.map((msg, idx) => {
          // Find the preceding user message timestamp for "Thought for" display
          let userTimestamp: number | undefined;
          if (msg.role === "assistant") {
            for (let i = idx - 1; i >= 0; i--) {
              if (messages[i].role === "user") {
                userTimestamp = messages[i].timestamp;
                break;
              }
            }
          }

          // Only show sparkle on the last assistant message
          const isLatestAssistant =
            msg.role === "assistant" &&
            idx ===
              messages.reduce(
                (last, m, i) => (m.role === "assistant" ? i : last),
                -1,
              );

          const prevTimestamp =
            idx > 0 ? messages[idx - 1].timestamp : undefined;

          return (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              userTimestamp={userTimestamp}
              prevTimestamp={prevTimestamp}
              elapsedSeconds={elapsedSeconds}
              isSubmitting={isSubmitting}
              isLatestAssistant={isLatestAssistant}
              onRetry={onRetry}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="order-3 shrink-0 border-t border-zinc-200 p-3 md:order-none dark:border-zinc-800">
        <div className="relative rounded-xl border border-zinc-200 bg-zinc-50 transition-colors focus-within:border-zinc-300 focus-within:bg-white dark:border-zinc-700 dark:bg-zinc-800/50 dark:focus-within:border-zinc-600 dark:focus-within:bg-zinc-800">
          <textarea
            ref={sidebarInputRef}
            className="block w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-11 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            aria-label={t("inputLabel")}
            aria-describedby="chat-input-help"
            rows={2}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              status === "READY"
                ? t("placeholderReady")
                : status === "GENERATING"
                  ? t("placeholderGenerating")
                  : t("placeholderDefault")
            }
            maxLength={MAX_USER_PROMPT_CHARS}
            disabled={isSubmitting || status === "GENERATING"}
          />
          <Button
            className="absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white transition hover:bg-zinc-800 aria-disabled:opacity-50 aria-disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:aria-disabled:hover:bg-zinc-100"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={t("send")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        </div>
        {/* <p
          id="chat-input-help"
          className="mt-1.5 hidden text-[10px] text-zinc-500 md:block dark:text-zinc-400"
        >
          {t("inputHelp")}
        </p> */}
      </div>
    </div>
  );
}
