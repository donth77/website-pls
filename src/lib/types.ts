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

export const ErrorCode = {
  PROMPT_BLOCKED: "PROMPT_BLOCKED",
  RATE_LIMIT: "RATE_LIMIT",
  SCREENING_UNAVAILABLE: "SCREENING_UNAVAILABLE",
  SCREENING_CONFIG: "SCREENING_CONFIG",
  VALIDATION: "VALIDATION",
  TURNSTILE: "TURNSTILE",
  GENERATION_LIMIT: "GENERATION_LIMIT",
  SESSION_RATE_LIMIT: "SESSION_RATE_LIMIT",
  FORBIDDEN: "FORBIDDEN",
  GUEST_BLOCKED_AUTH_IP: "GUEST_BLOCKED_AUTH_IP",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  PLATFORM_BUDGET_LOW: "PLATFORM_BUDGET_LOW",
  BYOK_INVALID: "BYOK_INVALID",
  BYOK_RATE_LIMIT: "BYOK_RATE_LIMIT",
  BYOK_AUTH_FAILED: "BYOK_AUTH_FAILED",
  BYOK_BAD_REQUEST: "BYOK_BAD_REQUEST",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function errorCodeToMessage(code: string | undefined | null): string {
  switch (code) {
    case ErrorCode.PROMPT_BLOCKED:
      return "Your prompt wasn't accepted by the safety filter. Try rephrasing it.";
    case ErrorCode.RATE_LIMIT:
      return "Too many requests — please wait a moment and try again.";
    case ErrorCode.SCREENING_UNAVAILABLE:
      return "Safety check is temporarily unavailable. Try again shortly.";
    case ErrorCode.SCREENING_CONFIG:
      return "There's a server misconfiguration. Please try again later.";
    case ErrorCode.VALIDATION:
      return "There was an issue with your prompt. Please check and try again.";
    case ErrorCode.TURNSTILE:
      return "Bot verification failed. Please try again.";
    case ErrorCode.GENERATION_LIMIT:
      return "You've used all your free generations. Sign up for more!";
    case ErrorCode.SESSION_RATE_LIMIT:
      return "Too many sessions created. Try again later.";
    case ErrorCode.FORBIDDEN:
      return "You don't have access to this resource.";
    case ErrorCode.GUEST_BLOCKED_AUTH_IP:
      return "An account has already been used from this network. Please sign in to continue.";
    case ErrorCode.EMAIL_NOT_VERIFIED:
      return "Please verify your email address before generating. Check your inbox for a verification link.";
    case ErrorCode.PLATFORM_BUDGET_LOW:
      return "Free generations are temporarily unavailable. Add your own Anthropic API key to continue.";
    case ErrorCode.BYOK_INVALID:
      return "That Anthropic API key didn't work. Check it and try again.";
    case ErrorCode.BYOK_RATE_LIMIT:
      return "Your Anthropic account is out of credits or rate-limited. Check usage at console.anthropic.com.";
    case ErrorCode.BYOK_AUTH_FAILED:
      return "Your Anthropic key was rejected mid-generation. It may have been revoked — paste a fresh one.";
    case ErrorCode.BYOK_BAD_REQUEST:
      return "Anthropic rejected the generation request. The prompt may be too long or hit a content policy.";
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
