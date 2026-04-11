import { embedMany } from "ai";
import type {
  EmbeddingModelV3,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider";
import { openai } from "@ai-sdk/openai";
import { createJinaEmbeddingModel } from "./embed/jina-adapter";

export const TARGET_DIMS = 1024;

export type EmbeddingProviderName = "jina" | "openai";
export type EmbedKind = "passage" | "query";

const VALID_PROVIDERS: EmbeddingProviderName[] = ["jina", "openai"];

interface Embedder {
  model: EmbeddingModelV3;
  providerOptions: SharedV3ProviderOptions;
}

function getEmbedder(provider: EmbeddingProviderName, kind: EmbedKind): Embedder {
  switch (provider) {
    case "jina":
      return {
        model: createJinaEmbeddingModel({
          apiKey: process.env.JINA_API_KEY ?? "",
          modelId: "jina-embeddings-v3",
        }),
        providerOptions: {
          jina: {
            outputDimension: TARGET_DIMS,
            inputType: kind === "query" ? "retrieval.query" : "retrieval.passage",
          },
        },
      };
    case "openai":
      return {
        model: openai.embedding("text-embedding-3-small"),
        providerOptions: {
          openai: { dimensions: TARGET_DIMS },
        },
      };
  }
}

/**
 * Read the ordered provider preference list from env.
 *
 * Default: "jina,openai" — Jina primary (free for 10M tokens lifetime),
 * OpenAI fallback (~$0.02/1M tokens — rounding error at MVP scale).
 *
 * Missing / invalid entries are silently filtered so operators can
 * configure a subset (e.g., just OpenAI for a guaranteed-reliable setup)
 * without the env var rejecting.
 */
export function readEmbeddingPreference(): EmbeddingProviderName[] {
  const raw = process.env.EMBEDDING_PROVIDERS ?? "jina,openai";
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EmbeddingProviderName =>
      (VALID_PROVIDERS as string[]).includes(s),
    );
  return parsed.length > 0 ? parsed : VALID_PROVIDERS;
}

interface CascadeResult {
  embeddings: number[][];
  provider: EmbeddingProviderName;
  attemptsTried: EmbeddingProviderName[];
}

export class AllEmbeddingProvidersFailedError extends Error {
  constructor(
    public readonly errors: ReadonlyArray<{
      provider: EmbeddingProviderName;
      error: unknown;
    }>,
  ) {
    const summary = errors
      .map(
        ({ provider, error }) =>
          `${provider}: ${error instanceof Error ? error.message : String(error)}`,
      )
      .join("; ");
    super(`All embedding providers failed: ${summary}`);
    this.name = "AllEmbeddingProvidersFailedError";
  }
}

/**
 * Ingestion path: walk the preference list in order. Return the first
 * provider that successfully embeds the full batch. The caller MUST pin
 * the returned provider name on the ReferenceDocument row — cross-provider
 * vectors live in different semantic spaces and are not comparable, so
 * retrieval later must use the same provider.
 *
 * Atomic: `embedMany` either returns every embedding or throws, so no
 * partial commits leak across providers in a single cascade walk.
 */
export async function embedPassagesWithCascade(
  values: string[],
): Promise<CascadeResult> {
  if (values.length === 0) {
    throw new Error("embedPassagesWithCascade called with empty values");
  }

  const preference = readEmbeddingPreference();
  const attemptsTried: EmbeddingProviderName[] = [];
  const errors: Array<{ provider: EmbeddingProviderName; error: unknown }> = [];

  for (const provider of preference) {
    attemptsTried.push(provider);
    try {
      const { model, providerOptions } = getEmbedder(provider, "passage");
      const { embeddings } = await embedMany({
        model,
        values,
        providerOptions,
      });
      return { embeddings, provider, attemptsTried };
    } catch (error) {
      errors.push({ provider, error });
    }
  }

  throw new AllEmbeddingProvidersFailedError(errors);
}

/**
 * Retrieval path: embed a single query with a pinned provider. No
 * fallback — if the pinned provider fails, the caller should treat this
 * as "no RAG context this generation" and return null. Falling back
 * would compare Jina vectors against OpenAI vectors (or vice versa),
 * which silently returns garbage matches.
 */
export async function embedQueryWithPinnedProvider(
  query: string,
  provider: EmbeddingProviderName,
): Promise<number[]> {
  const { model, providerOptions } = getEmbedder(provider, "query");
  const { embeddings } = await embedMany({
    model,
    values: [query],
    providerOptions,
  });
  return embeddings[0];
}

export function isValidEmbeddingProvider(
  value: string,
): value is EmbeddingProviderName {
  return (VALID_PROVIDERS as string[]).includes(value);
}
