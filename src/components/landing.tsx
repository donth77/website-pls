import { ArrowUp, CircleHelp } from "lucide-react";
import { MAX_USER_PROMPT_CHARS } from "@/lib/ai/promptSafety";

const EXAMPLE_PROMPTS = [
  "A portfolio site for a photographer with a dark theme, image gallery, and contact form",
  "A landing page for a coffee shop with menu, hours, location map, and online ordering",
  "A personal blog with a minimalist design, featured posts section, and newsletter signup",
  "A SaaS product landing page with pricing tiers, feature comparison, and testimonials",
];

export interface LandingProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  isMac: boolean;
  onInfoOpen: () => void;
}

export function Landing({
  inputValue,
  onInputChange,
  onSubmit,
  canSubmit,
  isMac,
  onInfoOpen,
}: LandingProps) {
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
            What would you like to build?
          </h1>
          <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400">
            Describe your website and we&apos;ll generate it in seconds.
          </p>
        </div>

        {/* Input */}
        <div className="relative rounded-2xl border border-zinc-200 bg-white shadow-lg shadow-zinc-200/50 transition-shadow focus-within:shadow-xl focus-within:shadow-zinc-200/60 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-zinc-900/50 dark:focus-within:shadow-zinc-900/60">
          <textarea
            className="block w-full resize-none rounded-2xl bg-transparent px-5 py-4 pr-14 text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            rows={4}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='e.g. "A portfolio site for a photographer with a dark theme and image gallery"'
            aria-label="Describe the website you want to build"
            maxLength={MAX_USER_PROMPT_CHARS}
            autoFocus
          />
          <button
            type="button"
            className="absolute right-3 bottom-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:hover:bg-zinc-100"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Generate website"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>

        {/* Char count (visible when typing) */}
        {inputValue.length > 0 && (
          <div
            className={`mt-2 text-right font-mono text-xs ${charCountColor}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {inputValue.length.toLocaleString()}/
            {MAX_USER_PROMPT_CHARS.toLocaleString()}
          </div>
        )}

        {/* Example prompts */}
        {!inputValue && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                className="cursor-pointer rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                onClick={() => onInputChange(ex)}
                aria-label={ex}
              >
                {ex.length > 55 ? ex.slice(0, 55) + "\u2026" : ex}
              </button>
            ))}
          </div>
        )}

        {/* Keyboard hint */}
        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          {isMac ? "\u2318" : "Ctrl"}+Enter to generate
        </p>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 flex items-center gap-3">
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
          WebsitePls
        </span>
        <button
          type="button"
          className="text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={onInfoOpen}
          aria-label="About this app"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}
