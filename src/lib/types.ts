export type GenerationStatus = "DRAFT" | "GENERATING" | "READY" | "ERROR";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  status?: GenerationStatus;
  progressStep?: string;
  progressPercent?: number;
  error?: string;
  errorCode?: string;
};

export function errorCodeToMessage(code: string | undefined | null): string {
  switch (code) {
    case "PROMPT_BLOCKED":
      return "Your prompt wasn't accepted by the safety filter. Try rephrasing it.";
    case "RATE_LIMIT":
      return "Too many requests — please wait a moment and try again.";
    case "SCREENING_UNAVAILABLE":
      return "Safety check is temporarily unavailable. Try again shortly.";
    case "SCREENING_CONFIG":
      return "There's a server misconfiguration. Please try again later.";
    case "VALIDATION":
      return "There was an issue with your prompt. Please check and try again.";
    case "TURNSTILE":
      return "Bot verification failed. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
