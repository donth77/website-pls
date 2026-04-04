import { ArrowUp, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@ariakit/react";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";
import { GenerationLimit } from "../generation-limit";

const EXAMPLE_KEYS = ["example1", "example2", "example3", "example4"] as const;

export interface LandingProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  isMac: boolean;
  onInfoOpen: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  turnstile?: React.ReactNode;
}

export function Landing({
  inputValue,
  onInputChange,
  onSubmit,
  canSubmit,
  isMac,
  onInfoOpen,
  textareaRef,
  turnstile,
}: LandingProps) {
  const t = useTranslations("Landing");
  const charRatio = inputValue.length / MAX_USER_PROMPT_CHARS;
  const charCountColor =
    charRatio >= 1
      ? "text-red-500"
      : charRatio >= 0.9
        ? "text-orange-500"
        : "text-zinc-400";

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <>
      <div className="w-full max-w-2xl">
        {/* Heading */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            {t("heading")}
          </h1>
          <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>

        {/* Input */}
        <div className="relative rounded-2xl border border-zinc-200 bg-white shadow-lg shadow-zinc-200/50 transition-shadow focus-within:shadow-xl focus-within:shadow-zinc-200/60 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-zinc-900/50 dark:focus-within:shadow-zinc-900/60">
          <textarea
            ref={textareaRef}
            className="block w-full resize-none rounded-2xl bg-transparent px-5 py-4 pr-14 text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            rows={4}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            maxLength={MAX_USER_PROMPT_CHARS}
            autoFocus
          />
          <Button
            className="absolute right-3 bottom-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-800 aria-disabled:opacity-50 aria-disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:aria-disabled:hover:bg-zinc-100"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={t("generate")}
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        </div>

        {/* Below-input area — fixed height so content changes don't shift the textarea */}
        <div className="h-44">
          {/* Char count (visible when typing) */}
          <div
            className={`mt-2 text-right font-mono text-xs transition-opacity ${inputValue.length > 0 ? "opacity-100" : "opacity-0"} ${charCountColor}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {inputValue.length.toLocaleString()}/
            {MAX_USER_PROMPT_CHARS.toLocaleString()}
          </div>

          {/* Example prompts */}
          <div
            className={`mt-2 flex flex-wrap justify-center gap-2 transition-opacity ${inputValue ? "pointer-events-none opacity-0" : "opacity-100"}`}
          >
            {EXAMPLE_KEYS.map((key) => {
              const text = t(key);
              return (
                <Button
                  key={key}
                  className="cursor-pointer rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  onClick={() => onInputChange(text)}
                  aria-label={text}
                >
                  {text.length > 55 ? text.slice(0, 55) + "\u2026" : text}
                </Button>
              );
            })}
          </div>

          {/* Keyboard hint */}
          {/* <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("keyboardHint", { key: isMac ? "\u2318" : "Ctrl" })}
          </p> */}

          {/* Generation limit indicator */}
          <div className="mt-3">
            <GenerationLimit />
          </div>

          {/* Turnstile widget */}
          {turnstile && (
            <div className="mt-3 flex justify-center">{turnstile}</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 flex items-center gap-3">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          WebsitePls
        </span>
        <Button
          className="text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={onInfoOpen}
          aria-label={t("aboutLabel")}
        >
          <CircleHelp className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
