import Anthropic from "@anthropic-ai/sdk";
import { parseJsonObject } from "./json";
import type { FetchLike, JsonRequest, LlmProvider } from "./llm";

/**
 * Anthropic's own guidance: start with Claude Opus 5.5 and move to Claude
 * Fable 5.2 (its most capable model, twice the price, thinking always on) only
 * when Opus falls short. Override with the ANTHROPIC_MODEL var.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Server-side refusal fallback is offered on these model families. Claude Haiku
 * 5.5 has none, and sending the parameter for it is an error.
 */
function supportsServerFallback(model: string): boolean {
  return /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/.test(model);
}

/** Structured outputs want closed objects, so add `additionalProperties: false` at every level. */
export function closeObjects(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== "object") return schema;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) copy[key] = closeObjects(value);
  if (copy.type === "object" && !("additionalProperties" in copy)) copy.additionalProperties = false;
  return copy;
}

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  effort?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function anthropicProvider(options: AnthropicOptions): LlmProvider {
  const model = options.model || DEFAULT_ANTHROPIC_MODEL;
  // Low effort: a one-sentence prompt doesn't need deep reasoning, and players are waiting on the call.
  const effort = EFFORTS.find((level) => level === options.effort) ?? "low";
  const client = new Anthropic({
    apiKey: options.apiKey,
    // One retry rides out a transient overload; beyond that a deck card beats keeping the group waiting.
    maxRetries: 1,
    timeout: options.timeoutMs ?? 12_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    name: "anthropic",
    async json(request: JsonRequest): Promise<Record<string, unknown>> {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const messages = request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

      const response = await client.beta.messages.create({
        model,
        // The answer is one sentence; the headroom is for the model's always-on thinking.
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages,
        output_config: {
          effort,
          format: { type: "json_schema", schema: closeObjects(request.schema) as Record<string, unknown> },
        },
        // If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
        ...(supportsServerFallback(model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });

      if (response.stop_reason === "refusal") {
        throw new Error(`declined (${response.stop_details?.category ?? "no category"})`);
      }
      if (response.stop_reason === "max_tokens") throw new Error("ran out of max_tokens");
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return parseJsonObject(text);
    },
  };
}
