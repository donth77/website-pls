import type { EmbeddingModelV3 } from "@ai-sdk/provider";

interface JinaConfig {
  apiKey: string;
  modelId?: string;
}

interface JinaProviderOptions {
  outputDimension?: number;
  inputType?: "retrieval.passage" | "retrieval.query";
}

interface JinaApiResponse {
  usage?: { total_tokens?: number };
  data: Array<{ index: number; embedding: number[] }>;
}

const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";

/**
 * Hand-rolled Vercel AI SDK v3 embedding adapter for Jina's REST API.
 *
 * Exists because the community `jina-ai-provider@1.0.0` package targets
 * `@ai-sdk/provider@^2` while AI SDK v6 uses `@ai-sdk/provider@^3`. The
 * version mismatch only works through Vercel's explicitly-marked-unstable
 * v2→v3 compat shim, which logs a deprecation warning on every call.
 * Owning ~60 lines of adapter is cheaper than depending on that shim.
 */
export function createJinaEmbeddingModel(config: JinaConfig): EmbeddingModelV3 {
  const modelId = config.modelId ?? "jina-embeddings-v3";

  return {
    specificationVersion: "v3",
    provider: "jina.ai",
    modelId,
    maxEmbeddingsPerCall: 2048,
    supportsParallelCalls: true,
    async doEmbed({ values, abortSignal, providerOptions, headers }) {
      const opts = ((providerOptions?.jina ?? {}) as JinaProviderOptions) ?? {};
      const body = {
        model: modelId,
        task: opts.inputType ?? "retrieval.passage",
        dimensions: opts.outputDimension ?? 1024,
        input: values,
        normalized: true,
      };

      const response = await fetch(JINA_EMBEDDINGS_URL, {
        method: "POST",
        signal: abortSignal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${config.apiKey}`,
          ...(headers ?? {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Jina embeddings API error ${response.status}: ${errorText}`,
        );
      }

      const json = (await response.json()) as JinaApiResponse;
      const sorted = [...json.data].sort((a, b) => a.index - b.index);

      return {
        embeddings: sorted.map((d) => d.embedding),
        usage:
          json.usage?.total_tokens != null
            ? { tokens: json.usage.total_tokens }
            : undefined,
        warnings: [],
      };
    },
  };
}
