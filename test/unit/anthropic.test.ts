import { describe, expect, it } from "vitest";
import { anthropicProvider, closeObjects, DEFAULT_ANTHROPIC_MODEL } from "../../src/ai/anthropic";
import { createLlm, type JsonRequest } from "../../src/ai/llm";

interface Captured {
  url: URL;
  headers: Headers;
  body: Record<string, any>;
}

/** Stands in for api.anthropic.com behind the official SDK's `fetch` option. */
function fakeAnthropic(replies: Array<{ status?: number; body: unknown }>) {
  const captured: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    captured.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected request");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  return { fetch, captured };
}

function message(text: string, extra: Record<string, unknown> = {}) {
  return {
    body: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: DEFAULT_ANTHROPIC_MODEL,
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 120, output_tokens: 40 },
      ...extra,
    },
  };
}

const request: JsonRequest = {
  messages: [
    { role: "system", content: "You write party prompts." },
    { role: "user", content: "One truth question, as JSON." },
  ],
  schemaName: "prompt",
  schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
};

describe("Claude question provider", () => {
  it("sends the documented request: Opus 5.5, low effort, JSON schema, default refusal fallback", async () => {
    const { fetch, captured } = fakeAnthropic([message('{"question":"你最近一次心动是什么时候？"}')]);
    const provider = anthropicProvider({ apiKey: "sk-test", fetch });
    expect(await provider.json(request)).toEqual({ question: "你最近一次心动是什么时候？" });

    const [call] = captured;
    expect(call!.url.pathname).toBe("/v1/messages");
    expect(call!.headers.get("authorization")).toBe("Bearer sk-test"); // SDK 1.x sends API keys as a bearer token
    expect(call!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call!.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: "You write party prompts.",
      messages: [{ role: "user", content: "One truth question, as JSON." }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { type: "object", additionalProperties: false } },
      },
      fallbacks: "default",
    });
    // Sampling parameters and thinking budgets are rejected by current models.
    expect(call!.body).not.toHaveProperty("temperature");
    expect(call!.body).not.toHaveProperty("thinking");
  });

  it("honours a different model and effort, and skips fallbacks where the model has none", async () => {
    const { fetch, captured } = fakeAnthropic([message('{"question":"a"}'), message('{"question":"b"}')]);
    await anthropicProvider({ apiKey: "k", model: "claude-fable-5-2", effort: "medium", fetch }).json(request);
    expect(captured[0]!.body).toMatchObject({ model: "claude-fable-5-2", output_config: { effort: "medium" }, fallbacks: "default" });

    await anthropicProvider({ apiKey: "k", model: "claude-haiku-5-5", effort: "nonsense", fetch }).json(request);
    expect(captured[1]!.body).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
    expect(captured[1]!.body).not.toHaveProperty("fallbacks");
    expect(captured[1]!.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it("treats a refusal as a miss so the next provider (or the deck) takes over", async () => {
    const { fetch } = fakeAnthropic([message("", { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })]);
    await expect(anthropicProvider({ apiKey: "k", fetch }).json(request)).rejects.toThrow(/declined/);
  });

  it("is first in line when its key is set, and falls through on errors", async () => {
    const anthropic = fakeAnthropic([{ status: 401, body: { type: "error", error: { type: "authentication_error", message: "bad key" } } }]);
    const deepseekReply = new Response(JSON.stringify({ choices: [{ message: { content: '{"question":"from deepseek"}' } }] }));
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes("anthropic") ? anthropic.fetch(input, init) : deepseekReply;
    };
    const llm = createLlm({ ANTHROPIC_API_KEY: "k", DEEPSEEK_API_KEY: "d" }, { fetch })!;
    expect(llm.providers).toEqual(["anthropic", "deepseek"]);
    expect(await llm.json(request)).toEqual({ value: { question: "from deepseek" }, provider: "deepseek" });
  });

  it("closes every object in a schema", () => {
    expect(
      closeObjects({
        type: "object",
        properties: { inner: { type: "object", properties: { x: { type: "string" } } }, list: { type: "array", items: { type: "object" } } },
      }),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        inner: { type: "object", additionalProperties: false, properties: { x: { type: "string" } } },
        list: { type: "array", items: { type: "object", additionalProperties: false } },
      },
    });
  });
});
