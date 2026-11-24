/**
 * Question-writing models, tried in order until one answers.
 *
 * Claude goes through the official Anthropic SDK (./anthropic.ts). DeepSeek and
 * Gemini share an OpenAI-compatible endpoint shape, handled by the small fetch
 * client below. If every configured provider fails, the caller falls back to
 * the built-in deck.
 */
import { anthropicProvider } from "./anthropic";
import { parseJsonObject } from "./json";

export { parseJsonObject };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonRequest {
  messages: ChatMessage[];
  /** JSON Schema of the expected object; used by providers that support schema-constrained output. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
}

export interface JsonResult {
  value: Record<string, unknown>;
  provider: string;
}

export interface Llm {
  readonly providers: string[];
  /** Resolves with the first provider's parsed JSON object; rejects if all providers fail. */
  json(request: JsonRequest): Promise<JsonResult>;
}

export interface LlmEnv {
  AI_PROVIDERS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One model behind the shared `json()` contract: resolve with a parsed object or throw. */
export interface LlmProvider {
  name: string;
  json(request: JsonRequest): Promise<Record<string, unknown>>;
}

interface OpenAiCompatible {
  name: string;
  url: string;
  apiKey: string;
  body(request: JsonRequest): Record<string, unknown>;
}

function deepseek(apiKey: string, model: string): OpenAiCompatible {
  return {
    name: "deepseek",
    url: "https://api.deepseek.com/chat/completions",
    apiKey,
    body: (request) => ({
      model,
      messages: request.messages,
      // DeepSeek's JSON mode is schema-less; the prompt itself must describe the shape.
      response_format: { type: "json_object" },
      // Thinking is on by default and adds seconds of latency a party game can't afford.
      thinking: { type: "disabled" },
      temperature: request.temperature ?? 1.1,
      max_tokens: request.maxTokens ?? 400,
      stream: false,
    }),
  };
}

function gemini(apiKey: string, model: string): OpenAiCompatible {
  return {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKey,
    body: (request) => ({
      model,
      messages: request.messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, schema: request.schema },
      },
      // Current Gemini Flash models cannot fully disable thinking; "minimal" is the floor.
      reasoning_effort: "minimal",
      temperature: request.temperature ?? 1.1,
      // Headroom for the small amount of thinking that still happens.
      max_tokens: Math.max(request.maxTokens ?? 400, 1024),
    }),
  };
}

export class LlmError extends Error {
  constructor(readonly failures: string[]) {
    super(`all LLM providers failed: ${failures.join(" | ")}`);
  }
}

export function createLlm(
  env: LlmEnv,
  options: { fetch?: FetchLike; timeoutMs?: number; anthropicTimeoutMs?: number } = {},
): Llm | null {
  // Calling the global fetch through a wrapper avoids Workers' "Illegal invocation" on detached fetch.
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 7000;
  const compatible = (config: OpenAiCompatible): LlmProvider => ({
    name: config.name,
    json: (request) => callCompatible(config, request, doFetch, timeoutMs),
  });

  const order = (env.AI_PROVIDERS ?? "anthropic,deepseek,gemini")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const providers: LlmProvider[] = [];
  for (const name of order) {
    if (name === "anthropic" && env.ANTHROPIC_API_KEY) {
      providers.push(
        anthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_MODEL,
          effort: env.ANTHROPIC_EFFORT,
          fetch: options.fetch,
          timeoutMs: options.anthropicTimeoutMs,
        }),
      );
    } else if (name === "deepseek" && env.DEEPSEEK_API_KEY) {
      providers.push(compatible(deepseek(env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL || "deepseek-flash")));
    } else if (name === "gemini" && env.GEMINI_API_KEY) {
      providers.push(compatible(gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.8-flash")));
    }
  }
  if (providers.length === 0) return null;

  return {
    providers: providers.map((provider) => provider.name),
    async json(request: JsonRequest): Promise<JsonResult> {
      const failures: string[] = [];
      for (const provider of providers) {
        try {
          return { value: await provider.json(request), provider: provider.name };
        } catch (error) {
          failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new LlmError(failures);
    },
  };
}

async function callCompatible(
  provider: OpenAiCompatible,
  request: JsonRequest,
  doFetch: FetchLike,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const response = await doFetch(provider.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(provider.body(request)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${response.status} ${detail}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
  // DeepSeek documents that JSON mode can return whitespace-only content; treat it as a miss.
  if (!content) throw new Error(`empty content (finish_reason=${payload.choices?.[0]?.finish_reason})`);
  return parseJsonObject(content);
}
