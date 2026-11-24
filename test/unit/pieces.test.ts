import type { Update } from "grammy/types";
import { describe, expect, it } from "vitest";
import { createLlm, parseJsonObject, type LlmEnv } from "../../src/ai/llm";
import { coreMessages } from "../../src/core/i18n";
import { migrate } from "../../src/core/schema";
import { exportSnapshot, importSnapshot } from "../../src/core/snapshot";
import { cleanQuestion } from "../../src/games/tod/ai";
import { DARES } from "../../src/games/tod/content/dares";
import { PENALTIES } from "../../src/games/tod/content/penalties";
import { TRUTHS } from "../../src/games/tod/content/truths";
import { allCards, drawCard } from "../../src/games/tod/deck";
import { todMessages } from "../../src/games/tod/i18n";
import { groupScopedCallback, routeChatId, stripGroupScope } from "../../src/routing";
import { parseRoomCallback, roomCallback } from "../../src/telegram/callback";
import { esc, splitForTelegram } from "../../src/telegram/html";
import { parseUpdate } from "../../src/telegram/intents";
import { appConfig } from "../../src/config";
import { alice, bob, createHarness, roomWith, seededRandom } from "../helpers/harness";
import { nodeSql } from "../helpers/node-sql";

describe("question deck", () => {
  const options = (overrides: Partial<Parameters<typeof drawCard>[1]> = {}) => ({
    level: 2 as const,
    dareTypes: ["voice", "post", "contact"] as Array<"voice" | "post" | "contact">,
    used: new Set<string>(),
    random: seededRandom(1),
    ...overrides,
  });

  it("never repeats a card until the matching pool is used up", () => {
    const used = new Set<string>();
    const random = seededRandom(5);
    const poolSize = TRUTHS.filter((card) => card.level === 1).length;
    for (let i = 0; i < poolSize; i++) {
      const card = drawCard("truth", options({ level: 1, used, random }));
      expect(used.has(card.id)).toBe(false);
      used.add(card.id);
    }
    expect(drawCard("truth", options({ level: 1, used, random })).level).toBe(1); // repeats now allowed
  });

  it("keeps mild games strictly mild and mixes one level down otherwise", () => {
    const random = seededRandom(9);
    const mild = Array.from({ length: 200 }, () => drawCard("dare", options({ level: 1, random })));
    expect(mild.every((card) => card.level === 1)).toBe(true);
    const hot = Array.from({ length: 400 }, () => drawCard("truth", options({ level: 3, random })));
    const levels = new Set(hot.map((card) => card.level));
    expect(levels).toEqual(new Set([2, 3]));
    const share = hot.filter((card) => card.level === 2).length / hot.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.35);
  });

  it("only draws enabled dare types, and voice dares come up less often", () => {
    const random = seededRandom(4);
    const onlyPost = Array.from({ length: 100 }, () => drawCard("dare", options({ dareTypes: ["post"], random })));
    expect(onlyPost.every((card) => card.type === "post")).toBe(true);
    const mixed = Array.from({ length: 2000 }, () => drawCard("dare", options({ random })));
    const voiceShare = mixed.filter((card) => card.type === "voice").length / mixed.length;
    expect(voiceShare).toBeLessThan(0.12);
    expect(voiceShare).toBeGreaterThan(0.02);
  });
});

describe("deck content", () => {
  const cards = allCards();

  it("has unique ids whose prefix matches kind and level", () => {
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    for (const [prefix, pool] of [["t", TRUTHS], ["d", DARES], ["p", PENALTIES]] as const) {
      for (const card of pool) expect(card.id).toMatch(new RegExp(`^${prefix}${card.level}-\\d{2}$`));
    }
  });

  it("gives every dare and penalty a type, and no truth one", () => {
    expect(TRUTHS.every((card) => card.type === undefined)).toBe(true);
    expect([...DARES, ...PENALTIES].every((card) => card.type !== undefined)).toBe(true);
  });

  it("has a natural-looking Chinese and English version of every card", () => {
    for (const card of cards) {
      expect(card.zh, card.id).toMatch(/[一-鿿]/);
      expect(card.en, card.id).not.toMatch(/[一-鿿]/);
      expect(card.zh.length, card.id).toBeLessThanOrEqual(70);
      expect(card.en.length, card.id).toBeLessThanOrEqual(140);
      expect(card.zh.trim()).toBe(card.zh);
      expect(card.en.trim()).toBe(card.en);
    }
  });

  it("covers every level and dare type so filters never come up empty", () => {
    for (const level of [1, 2, 3]) {
      expect(TRUTHS.filter((card) => card.level === level).length).toBeGreaterThanOrEqual(25);
      for (const type of ["voice", "post", "contact"]) {
        expect(DARES.some((card) => card.level === level && card.type === type), `dare ${level}/${type}`).toBe(true);
        expect(PENALTIES.some((card) => card.level === level && card.type === type), `penalty ${level}/${type}`).toBe(true);
      }
    }
  });

  it("keeps voice performances a minority of dares", () => {
    const voice = DARES.filter((card) => card.type === "voice").length;
    expect(voice / DARES.length).toBeLessThan(0.2);
  });

  it("never asks for a camera or video", () => {
    for (const card of [...DARES, ...PENALTIES]) {
      expect(card.zh, card.id).not.toMatch(/视频|摄像头|开镜头/);
      expect(card.en.toLowerCase(), card.id).not.toMatch(/video|camera on|webcam/);
    }
  });
});

describe("translations", () => {
  it("has no empty strings in either language", () => {
    for (const messages of [coreMessages.zh, coreMessages.en, todMessages.zh, todMessages.en]) {
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value === "string") expect(value.length, key).toBeGreaterThan(0);
      }
    }
  });
});

describe("parsing updates", () => {
  const message = (text: string, entities: unknown[], extra: object = {}): Update =>
    ({
      update_id: 1,
      message: {
        message_id: 5,
        date: 0,
        chat: { id: -100, type: "supergroup", title: "G" },
        from: { id: 1, is_bot: false, first_name: "A" },
        text,
        entities,
        ...extra,
      },
    }) as Update;

  it("reads the command, its arguments and its target bot", () => {
    const update = message("/play@TestGameBot tod", [{ type: "bot_command", offset: 0, length: 17 }]);
    expect(parseUpdate(update, "TestGameBot")).toMatchObject({ type: "command", command: "play", args: "tod" });
    expect(parseUpdate(update, "SomeoneElseBot")).toMatchObject({ type: "noop" });
  });

  it("finds @mentions after CJK text and emoji (UTF-16 offsets)", () => {
    const text = "/invite 🎉朋友 @bob 和 @dave";
    const at = (needle: string) => text.indexOf(needle);
    const update = message(text, [
      { type: "bot_command", offset: 0, length: 7 },
      { type: "mention", offset: at("@bob"), length: 4 },
      { type: "mention", offset: at("@dave"), length: 5 },
    ]);
    const intent = parseUpdate(update, null);
    expect(intent.type === "command" && intent.mentions).toEqual([
      { kind: "username", username: "bob" },
      { kind: "username", username: "dave" },
    ]);
  });

  it("keeps forum topic ids and resolves text mentions and replies", () => {
    const update = message(
      "/invite Carol",
      [
        { type: "bot_command", offset: 0, length: 7 },
        { type: "text_mention", offset: 8, length: 5, user: { id: 3, is_bot: false, first_name: "Carol" } },
      ],
      {
        is_topic_message: true,
        message_thread_id: 44,
        reply_to_message: { message_id: 2, date: 0, chat: { id: -100, type: "supergroup" }, from: { id: 4, is_bot: false, first_name: "D" } },
      },
    );
    const intent = parseUpdate(update, null);
    expect(intent).toMatchObject({
      threadId: 44,
      replyToUser: { id: 4 },
      mentions: [{ kind: "user", user: { id: 3, firstName: "Carol" } }],
    });
  });

  it("ignores plain chatter", () => {
    expect(parseUpdate(message("hello", []), null)).toMatchObject({ type: "noop" });
  });
});

describe("routing", () => {
  it("sends group traffic to the group's object", () => {
    expect(routeChatId({ update_id: 1, message: { chat: { id: -100, type: "supergroup" }, text: "/play" } } as Update)).toBe(-100);
  });

  it("sends deep-link starts from DMs to the group they came from", () => {
    const update = { update_id: 1, message: { chat: { id: 7, type: "private" }, text: "/start g-1001234567890" } } as Update;
    expect(routeChatId(update)).toBe(-1001234567890);
    const plain = { update_id: 1, message: { chat: { id: 7, type: "private" }, text: "/start" } } as Update;
    expect(routeChatId(plain)).toBe(7);
  });

  it("sends DM button presses to the group named in the payload", () => {
    const data = groupScopedCallback(-1009, roomCallback(3, "g", "x"));
    const update = { update_id: 1, callback_query: { id: "1", data, message: { chat: { id: 7, type: "private" } } } } as Update;
    expect(routeChatId(update)).toBe(-1009);
    expect(stripGroupScope(data)).toBe("r3:g:x");
  });
});

describe("callback payloads", () => {
  it("round-trip and stay under Telegram's 64-byte limit", () => {
    const data = roomCallback(123456, "g", "v", 99, "y");
    expect(parseRoomCallback(data)).toEqual({ roomId: 123456, action: "g", args: ["v", "99", "y"] });
    expect(() => roomCallback(1, "x".repeat(70))).toThrow(/64 bytes/);
    expect(parseRoomCallback("garbage")).toBeNull();
  });
});

describe("html helpers", () => {
  it("escape the three characters Telegram cares about", () => {
    expect(esc(`<b>"Tom & Jerry"</b>`)).toBe(`&lt;b&gt;"Tom &amp; Jerry"&lt;/b&gt;`);
  });

  it("split long text on line boundaries", () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
    const chunks = splitForTelegram(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join("\n")).toBe(text);
  });
});

describe("config", () => {
  it("reads the chat allowlist and default language", () => {
    expect(appConfig({ ALLOWED_CHAT_IDS: "-100, -200 ,", DEFAULT_LANG: "en" })).toEqual({
      defaultLang: "en",
      allowedChatIds: new Set([-100, -200]),
      webAppName: null,
    });
    expect(appConfig({})).toEqual({ defaultLang: "zh", allowedChatIds: null, webAppName: null });
  });

  it("takes the Mini App short name only when BotFather would accept it", () => {
    expect(appConfig({ MINIAPP_SHORT_NAME: " play " }).webAppName).toBe("play");
    expect(appConfig({ MINIAPP_SHORT_NAME: "word_game_2" }).webAppName).toBe("word_game_2");
    for (const bad of ["", "ab", "has space", "t.me/x", "a".repeat(31)]) {
      expect(appConfig({ MINIAPP_SHORT_NAME: bad }).webAppName).toBeNull();
    }
  });
});

describe("LLM client", () => {
  type Call = { url: string; body: Record<string, unknown> };

  function fakeFetch(responses: Array<() => Response | Promise<Response>>) {
    const calls: Call[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      const next = responses.shift();
      if (!next) throw new Error("unexpected call");
      return next();
    };
    return { fetch, calls };
  }

  const ok = (content: string) => () =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });

  const request = {
    messages: [{ role: "user" as const, content: "json please" }],
    schema: { type: "object" },
    schemaName: "q",
  };
  const keys: LlmEnv = { DEEPSEEK_API_KEY: "ds", GEMINI_API_KEY: "gm" };

  it("is off when no key is configured", () => {
    expect(createLlm({})).toBeNull();
    expect(createLlm({ AI_PROVIDERS: "gemini", DEEPSEEK_API_KEY: "ds" })).toBeNull();
  });

  it("asks DeepSeek for fast JSON-mode output", async () => {
    const { fetch, calls } = fakeFetch([ok('{"question":"hi"}')]);
    const llm = createLlm(keys, { fetch })!;
    expect(llm.providers).toEqual(["deepseek", "gemini"]);
    expect(await llm.json(request)).toEqual({ value: { question: "hi" }, provider: "deepseek" });
    expect(calls[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0]!.body).toMatchObject({
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
  });

  it("falls through to Gemini with a JSON schema and minimal reasoning", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("overloaded", { status: 503 }), ok("```json\n{\"question\":\"yo\"}\n```")]);
    const llm = createLlm(keys, { fetch })!;
    expect(await llm.json(request)).toEqual({ value: { question: "yo" }, provider: "gemini" });
    expect(calls[1]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(calls[1]!.body).toMatchObject({
      model: "gemini-3.8-flash",
      reasoning_effort: "minimal",
      response_format: { type: "json_schema", json_schema: { name: "q" } },
    });
  });

  it("treats DeepSeek's blank JSON-mode reply as a failure", async () => {
    const { fetch } = fakeFetch([ok("   "), ok('{"question":"from gemini"}')]);
    const llm = createLlm(keys, { fetch })!;
    expect((await llm.json(request)).provider).toBe("gemini");
  });

  it("gives up when every provider fails, reporting each reason", async () => {
    const { fetch } = fakeFetch([() => new Response("no", { status: 401 }), ok("not json at all")]);
    const llm = createLlm(keys, { fetch })!;
    await expect(llm.json(request)).rejects.toThrow(/deepseek: HTTP 401.*gemini: not a JSON object/);
  });

  it("times out a provider that hangs", async () => {
    const hang = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const llm = createLlm({ DEEPSEEK_API_KEY: "ds" }, { fetch: hang, timeoutMs: 20 })!;
    await expect(llm.json(request)).rejects.toThrow(/aborted/);
  });

  it("parses JSON wrapped in prose", () => {
    expect(parseJsonObject('Sure! {"question": "a"} hope that helps')).toEqual({ question: "a" });
    expect(() => parseJsonObject("[1,2]")).toThrow();
  });

  it("cleans up generated questions", () => {
    expect(cleanQuestion("「  你最怕什么？ 」")).toBe("你最怕什么？");
    expect(cleanQuestion('"What scares you?\n"')).toBe("What scares you?");
    expect(cleanQuestion("hi")).toBeNull();
    expect(cleanQuestion(42)).toBeNull();
    expect(cleanQuestion("x".repeat(300))).toBeNull();
  });
});

describe("supergroup migration snapshot", () => {
  it("copies members, rooms and the turn log into a fresh chat", async () => {
    const h = createHarness();
    await roomWith(h, [bob]);
    await h.press(alice, h.room().messageId, "跳过本轮"); // logs one skipped turn
    await h.command(alice, "/lang en");
    const snapshot = exportSnapshot(h.sql);

    const target = nodeSql();
    migrate(target);
    expect(importSnapshot(target, snapshot)).toBe(true);
    expect(target.all("SELECT * FROM turn_log")).toHaveLength(1);
    expect(target.all("SELECT * FROM members")).toHaveLength(2);
    expect(target.first<{ value: string }>("SELECT value FROM kv WHERE key = 'lang'")?.value).toBe("en");
    // schema version belongs to the target and must survive
    expect(target.first<{ value: string }>("SELECT value FROM kv WHERE key = 'schema_version'")?.value).toBe("1");
    // a second import never overwrites live data
    expect(importSnapshot(target, snapshot)).toBe(false);
  });
});
