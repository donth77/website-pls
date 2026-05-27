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
import {
  adaptiveEffortFor,
  thinkingBudgetFor,
  usesAdaptiveThinking,
  type Provider,
  type ReasoningEffort,
} from "@/lib/byok/providers";

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
  /** OpenAI / OpenRouter reasoning dial — ignored by Anthropic. */
  reasoningEffort?: ReasoningEffort;
  /** Enable Anthropic extended thinking. The request shape (legacy
   *  `budget_tokens` vs adaptive + effort) is decided per-model below. */
  anthropicThinking?: boolean;
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
    // maxRetries: 0 — the BullMQ worker owns retry policy. The SDK's
    // default of 2 + our `attempts: 2` would create cascading retries
    // and surprise users with multi-minute hangs on transient 429s.
    const anthropic = new Anthropic({ apiKey, maxRetries: 0 });

    // Extended-thinking request shape depends on the model:
    //   - Opus 4.7 *requires* `thinking: { type: "adaptive" }` + an
    //     effort knob on `output_config.effort`; the legacy
    //     `{ type: "enabled", budget_tokens }` shape returns 400.
    //   - Sonnet 4.6 / Opus 4.6 support both but adaptive is preferred
    //     per Anthropic's migration guide.
    //   - Older 4.x models (Haiku 4.5, Sonnet 4.5, Opus 4.1/4.5) only
    //     accept the legacy enabled+budget shape.
    const thinkingEnabled = input.anthropicThinking === true;
    const useAdaptive = thinkingEnabled && usesAdaptiveThinking(model);
    const useLegacyThinking =
      thinkingEnabled && !usesAdaptiveThinking(model);

    // Only Opus 4.7 forbids custom `temperature`; the extended-thinking
    // docs do not restrict it on the older models, so we keep it on
    // Sonnet 4.5 / Haiku 4.5 / Opus 4.1/4.5 even when thinking is on.
    const allowsTemperature = !model.startsWith("claude-opus-4-7");

    // Build output_config: format is always required, effort only when
    // adaptive thinking is active.
    const outputConfig: {
      format: ReturnType<typeof zodOutputFormat>;
      effort?: "low" | "medium" | "high" | "max";
    } = { format: zodOutputFormat(schema) };
    if (useAdaptive) {
      outputConfig.effort = adaptiveEffortFor(model);
    }

    const stream = anthropic.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(allowsTemperature ? { temperature } : {}),
      ...(useAdaptive
        ? { thinking: { type: "adaptive" as const } }
        : useLegacyThinking
          ? {
              thinking: {
                type: "enabled" as const,
                budget_tokens: thinkingBudgetFor(model),
              },
            }
          : {}),
      system: systemBlocks,
      messages: [{ role: "user", content: userContent }],
      output_config: outputConfig,
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
  // maxRetries: 0 — same reasoning as the Anthropic client: the BullMQ
  // worker is the single source of truth for retry policy.
  const client = new OpenAI({
    apiKey,
    baseURL:
      provider === "openrouter" ? OPENROUTER_BASE_URL : undefined,
    maxRetries: 0,
  });

  // Flatten Anthropic-shaped system blocks into a single OpenAI system
  // message — OpenAI doesn't have a separate ephemeral-cache concept,
  // and prompt caching is automatic on supported models. Concatenating
  // with double-newlines preserves block boundaries for the model.
  const systemContent = systemBlocks.map((b) => b.text).join("\n\n");

  // OpenAI's reasoning-tier models (GPT-5.x, o-series) reject:
  //   - `max_tokens`  → require `max_completion_tokens` instead
  //   - custom `temperature` → only the default (1) is allowed
  // The newer `max_completion_tokens` field works on older chat models
  // too, so it's safe to always use. For temperature we omit it entirely:
  // trying to detect which model IDs are reasoning-tier is brittle (the
  // list changes over time). OpenRouter forwards both quirks to its
  // upstream models.
  //
  // Streaming is critical here, not just nice-to-have. Reasoning models
  // can think silently for minutes before emitting visible tokens. With
  // a non-streaming `parse()` call, any intermediate proxy (Cloudflare,
  // a dev server, the platform's load balancer) will time the idle TCP
  // connection out and the user sees "Connection error" after several
  // minutes. Streaming keeps chunks flowing so the connection stays
  // warm; `finalChatCompletion()` resolves to the same parsed payload
  // `chat.completions.parse()` would have returned.
  void temperature;

  // OpenAI and OpenRouter share the chat-completions surface but diverge
  // on two params:
  //   - tokens cap: OpenAI uses `max_completion_tokens` (newer field,
  //     required on reasoning models). OpenRouter docs use `max_tokens`
  //     throughout; acceptance of `max_completion_tokens` is undocumented.
  //   - reasoning: OpenAI uses top-level `reasoning_effort`. OpenRouter's
  //     documented shape is `reasoning: { effort: <value> }`; sending the
  //     flat field may be silently dropped on some upstreams.
  // reasoning is gated at the hook layer (only sent when the UI shows
  // the dial — full-size gpt-5.x / o-series only).
  const isOpenRouter = provider === "openrouter";
  const tokensField = isOpenRouter
    ? { max_tokens: maxTokens }
    : { max_completion_tokens: maxTokens };
  const reasoningField = input.reasoningEffort
    ? isOpenRouter
      ? { reasoning: { effort: input.reasoningEffort } }
      : { reasoning_effort: input.reasoningEffort }
    : {};

  // OpenAI SDK's type doesn't know about OpenRouter's `reasoning` object,
  // so we widen the param object once and pass through. Same SDK either
  // way; only the wire shape differs.
  const streamParams = {
    model,
    ...tokensField,
    ...reasoningField,
    messages: [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent },
    ],
    response_format: zodResponseFormat(schema, schemaName),
  };
  const stream = client.chat.completions.stream(
    streamParams as Parameters<typeof client.chat.completions.stream>[0],
  );

  // Surface SDK stream-level errors so Node doesn't crash on an unhandled
  // 'error' event before finalChatCompletion() resolves.
  if (input.onStreamError) {
    stream.on("error", input.onStreamError);
  }

  const completion = await stream.finalChatCompletion();
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
