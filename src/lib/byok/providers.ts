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

export const OPENAI_MODELS = {
  // Structured Outputs supported by all three of these:
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4o": "gpt-4o",
  "gpt-4.1": "gpt-4.1",
} as const;

export type AnthropicModelAlias = keyof typeof ANTHROPIC_MODELS;
export type OpenAIModelAlias = keyof typeof OPENAI_MODELS;

/** Default model per provider. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: ANTHROPIC_MODELS.sonnet,
  openai: OPENAI_MODELS["gpt-4o"],
  openrouter: "anthropic/claude-sonnet-4",
};

/** UI-displayable aliases for the fixed providers. OpenRouter is free-form. */
export function listFixedModels(
  provider: Provider,
): { alias: string; id: string }[] {
  if (provider === "anthropic") {
    return Object.entries(ANTHROPIC_MODELS).map(([alias, id]) => ({
      alias,
      id,
    }));
  }
  if (provider === "openai") {
    return Object.entries(OPENAI_MODELS).map(([alias, id]) => ({
      alias,
      id,
    }));
  }
  return [];
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
