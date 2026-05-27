/**
 * Provider-agnostic structured generation. Returns a parsed object that
 * matches the supplied Zod schema, regardless of which SDK is used under
 * the hood.
 *
 * Implementations:
 *   - anthropic: Anthropic SDK stream + zodOutputFormat (existing path,
 *     supports the orchestrator's partial-JSON progress heuristics)
 *   - openai:    OpenAI SDK chat.completions.parse + zodResponseFormat
 *   - openrouter: OpenAI SDK with custom baseURL — OpenRouter is API-
 *     compatible, and we already filtered the model list to entries
 *     that support structured outputs.
 *
 * The OpenAI/OpenRouter path is non-streaming for now: progress jumps
 * straight from "generating" to "processing" with no sub-step
 * heuristics. Streaming with structured parse is possible but the
 * sub-step inference is Anthropic-stream-specific.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { Provider } from "@/lib/byok/providers";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface GenerateStructuredInput<Schema extends z.ZodType> {
  provider: Provider;
  apiKey: string;
  model: string;
  systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  userContent: string;
  schema: Schema;
  /** Schema name — required by OpenAI's response_format API. */
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional Anthropic-stream hook for partial-JSON progress heuristics. */
  onAnthropicPartialJson?: (partialJson: unknown) => void;
  /** Optional error logger for stream-level Anthropic errors. */
  onStreamError?: (err: unknown) => void;
}

export interface GenerateStructuredResult<Schema extends z.ZodType> {
  parsed: z.infer<Schema>;
  stopReason: string | null;
}

export async function generateStructured<Schema extends z.ZodType>(
  input: GenerateStructuredInput<Schema>,
): Promise<GenerateStructuredResult<Schema>> {
  const {
    provider,
    apiKey,
    model,
    systemBlocks,
    userContent,
    schema,
    schemaName,
    maxTokens = 16384,
    temperature = 0.7,
  } = input;

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey });
    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemBlocks,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (input.onStreamError) {
      stream.on("error", input.onStreamError);
    }
    if (input.onAnthropicPartialJson) {
      stream.on("inputJson", input.onAnthropicPartialJson);
    }

    const response = await stream.finalMessage();
    const parsed = response.parsed_output as z.infer<Schema> | null;
    if (!parsed) {
      throw new Error("Anthropic returned no parsed output.");
    }
    return { parsed, stopReason: response.stop_reason ?? null };
  }

  // OpenAI + OpenRouter share the OpenAI SDK; only baseURL differs.
  const client = new OpenAI({
    apiKey,
    baseURL:
      provider === "openrouter" ? OPENROUTER_BASE_URL : undefined,
  });

  // Flatten Anthropic-shaped system blocks into a single OpenAI system
  // message — OpenAI doesn't have a separate ephemeral-cache concept,
  // and prompt caching is automatic on supported models. Concatenating
  // with double-newlines preserves block boundaries for the model.
  const systemContent = systemBlocks.map((b) => b.text).join("\n\n");

  const completion = await client.chat.completions.parse({
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    response_format: zodResponseFormat(schema, schemaName),
  });

  const choice = completion.choices[0];
  const parsed = choice?.message.parsed as z.infer<Schema> | null;
  if (!parsed) {
    // OpenAI returns a `refusal` field when the model declines.
    const refusal = choice?.message.refusal;
    throw new Error(
      refusal
        ? `Model refused: ${refusal}`
        : "OpenAI returned no parsed output.",
    );
  }
  return { parsed, stopReason: choice?.finish_reason ?? null };
}
