/**
 * BYOK provider taxonomy. Each provider supplies:
 *   - an SDK shape (Anthropic native; OpenAI + OpenRouter both use the
 *     OpenAI SDK, OpenRouter just with a different baseURL)
 *   - a key prefix the format validator can check before contacting the
 *     network
 *   - a "model" concept (Anthropic uses aliases mapped to dated IDs,
 *     OpenAI uses fixed IDs, OpenRouter is dynamic from /api/v1/models)
 *
 * Code that branches on provider should import the `Provider` union
 * here so adding a fourth provider later is a single-file edit.
 */

export const PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const DEFAULT_PROVIDER: Provider = "anthropic";

export interface ProviderMeta {
  label: string;
  /** Key prefix used for cheap format validation. */
  keyPrefix: string;
  /** Human-readable hint shown in the UI ("sk-ant-...", etc.). */
  keyPlaceholder: string;
  /** Where to grab a key. Shown as a link in the BYOK panel. */
  consoleUrl: string;
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  anthropic: {
    label: "Anthropic",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-…",
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    // Covers both legacy `sk-...` and project-scoped `sk-proj-...`.
    keyPrefix: "sk-",
    keyPlaceholder: "sk-… or sk-proj-…",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  openrouter: {
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    keyPlaceholder: "sk-or-v1-…",
    consoleUrl: "https://openrouter.ai/keys",
  },
};

/**
 * Provider-specific models we expose in the picker. Anthropic and OpenAI
 * are fixed allowlists (kept aligned with their structured-output-capable
 * tiers); OpenRouter is populated at runtime from /api/v1/models filtered
 * by `supported_parameters.includes("structured_outputs")`.
 */
export const ANTHROPIC_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
} as const;

// OpenAI catalog — kept aligned with developers.openai.com/api/docs/models.
// Latest first, then the previous-generation 4-family kept around because
// some users still prefer them for cost/latency. Ordering here also drives
// the combobox display order.
export const OPENAI_MODELS = {
  "gpt-5.5": "gpt-5.5",
  "gpt-5.4": "gpt-5.4",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "gpt-5.4-nano": "gpt-5.4-nano",
  "gpt-4.1": "gpt-4.1",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
} as const;

export type AnthropicModelAlias = keyof typeof ANTHROPIC_MODELS;
export type OpenAIModelAlias = keyof typeof OPENAI_MODELS;

/** Default model per provider. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: ANTHROPIC_MODELS.sonnet,
  // gpt-5.4 sits in the same "balanced mid-tier" spot Sonnet does for
  // Anthropic — sensible default when the user doesn't pick explicitly.
  openai: OPENAI_MODELS["gpt-5.4"],
  openrouter: "anthropic/claude-sonnet-4",
};

/**
 * Friendly display labels per alias. Anthropic gets title-case tier
 * names; OpenAI keeps its lowercase API IDs because they're recognizable
 * and look wrong when capitalized (e.g. "Gpt-4O").
 */
const MODEL_LABELS: Record<Provider, Record<string, string>> = {
  anthropic: {
    haiku: "Haiku",
    sonnet: "Sonnet",
    opus: "Opus",
  },
  openai: {
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 mini",
    "gpt-5.4-nano": "GPT-5.4 nano",
    "gpt-4.1": "GPT-4.1",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o mini",
  },
  openrouter: {},
};

/** UI-displayable aliases for the fixed providers. OpenRouter is free-form. */
export function listFixedModels(
  provider: Provider,
): { alias: string; id: string; label: string }[] {
  if (provider === "anthropic") {
    return Object.entries(ANTHROPIC_MODELS).map(([alias, id]) => ({
      alias,
      id,
      label: MODEL_LABELS.anthropic[alias] ?? alias,
    }));
  }
  if (provider === "openai") {
    return Object.entries(OPENAI_MODELS).map(([alias, id]) => ({
      alias,
      id,
      label: MODEL_LABELS.openai[alias] ?? alias,
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Reasoning / extended thinking
// ---------------------------------------------------------------------------

/**
 * OpenAI's GPT-5 reasoning models accept these five effort values.
 * Older docs listed "minimal" but the API rejects it ("Supported values
 * are: 'none', 'low', 'medium', 'high', and 'xhigh'."), so we use the
 * current set. `none` disables reasoning entirely.
 */
export const REASONING_EFFORT_OPTIONS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number];

/** Default effort when an OpenAI reasoning model is picked without override.
 *  `none` keeps generation fast and avoids the 5-min-timeout case; users
 *  can crank it up explicitly if they want better output. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

/**
 * Anthropic exposes two thinking APIs:
 *   - Legacy: `thinking: { type: "enabled", budget_tokens: N }`
 *   - Adaptive (newer): `thinking: { type: "adaptive" }` + `output_config.effort`
 *
 * Opus 4.7 REQUIRES adaptive (legacy enabled returns 400). Sonnet 4.6 and
 * Opus 4.6 support both but adaptive is preferred per the migration guide.
 * Haiku 4.5 and older 4.x snapshots only support the legacy shape.
 */
export function usesAdaptiveThinking(modelId: string): boolean {
  return (
    modelId.startsWith("claude-opus-4-7") ||
    modelId.startsWith("claude-opus-4-6") ||
    modelId.startsWith("claude-sonnet-4-6")
  );
}

/**
 * Effort level passed to Anthropic's adaptive thinking via
 * `output_config.effort`. The live API accepts `low|medium|high|max`
 * (plus `xhigh` on Opus 4.7), but `@anthropic-ai/sdk` v0.80.0's
 * TypeScript types only know about `low|medium|high|max`. Once we
 * upgrade the SDK we can return `xhigh` for Opus 4.7 — until then
 * `high` is the safest cross-model value.
 */
export function adaptiveEffortFor(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelId: string,
): "low" | "medium" | "high" | "max" {
  // Param is intentionally accepted (and ignored) so call sites stay
  // model-aware. Once the SDK's effort union includes "xhigh", switch
  // to returning "xhigh" for opus-4-7.
  return "high";
}

/**
 * Anthropic legacy-thinking budget per model. `budget_tokens` must be
 * >= 1024 and < max_tokens. Opus tiers get more budget than Sonnet
 * because they're positioned for deeper reasoning. Only consulted on
 * the legacy thinking path (Haiku 4.5, older 4.x snapshots).
 */
const THINKING_BUDGET_FALLBACK = 6000;

export function thinkingBudgetFor(modelId: string): number {
  if (modelId.startsWith("claude-opus-4-5")) return 12000;
  if (modelId.startsWith("claude-opus-4-1")) return 10000;
  if (modelId.startsWith("claude-sonnet-4-5")) return 6000;
  return THINKING_BUDGET_FALLBACK;
}

/**
 * OpenAI reasoning-tier models accept `reasoning_effort`. Mini and nano
 * variants technically accept it too, but they're positioned as the
 * "fast and cheap" options where exposing a reasoning dial is more
 * confusing than useful — we treat them as non-reasoning for UI gating.
 * The regex matches `-mini` / `-nano` as a suffix or followed by a date
 * (e.g. `o3-mini-2025-01-31`).
 */
export function isOpenAIReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  const inReasoningFamily =
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4");
  const isMiniOrNano = /-(mini|nano)(-|$)/.test(m);
  return inReasoningFamily && !isMiniOrNano;
}

/**
 * Anthropic models that support extended thinking via
 * `thinking: { type: "enabled", budget_tokens: N }`.
 * Sonnet 4.5+ and Opus 4.1+ qualify; Haiku 4.5 and 3.x models do not.
 */
export function isAnthropicThinkingCapable(model: string): boolean {
  return (
    model.startsWith("claude-sonnet-4-5") ||
    model.startsWith("claude-sonnet-4-6") ||
    model.startsWith("claude-opus-4-1") ||
    model.startsWith("claude-opus-4-5") ||
    model.startsWith("claude-opus-4-6") ||
    model.startsWith("claude-opus-4-7")
  );
}

/**
 * Convert a UI-side alias (or already-full id) to the wire model ID
 * the provider's API actually expects. Strangers fall through to the
 * default so server-side validation can reject explicitly.
 */
export function resolveModelId(
  provider: Provider,
  aliasOrId: string | null | undefined,
): string {
  if (!aliasOrId) return DEFAULT_MODEL[provider];
  if (provider === "anthropic") {
    return (
      (ANTHROPIC_MODELS as Record<string, string>)[aliasOrId] ?? aliasOrId
    );
  }
  if (provider === "openai") {
    return (OPENAI_MODELS as Record<string, string>)[aliasOrId] ?? aliasOrId;
  }
  // OpenRouter accepts whatever the cached model list provided.
  return aliasOrId;
}
