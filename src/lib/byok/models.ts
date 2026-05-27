/**
 * BYOK model selector — short aliases the client sends, mapped to the full
 * Anthropic model IDs the orchestrator expects. Kept in sync with the
 * STRUCTURED_OUTPUT_MODELS list in `src/lib/ai/orchestrator.ts`.
 */
export const BYOK_MODELS = {
  haiku: "claude-haiku-4-5-20250514",
  sonnet: "claude-sonnet-4-5-20250514",
  opus: "claude-opus-4-5-20250514",
} as const;

export type ByokModelAlias = keyof typeof BYOK_MODELS;

export const DEFAULT_BYOK_MODEL: ByokModelAlias = "sonnet";

export function resolveByokModel(alias: string | null | undefined): string | null {
  if (!alias) return null;
  return (BYOK_MODELS as Record<string, string>)[alias] ?? null;
}
