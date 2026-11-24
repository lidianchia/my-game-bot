import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as rawEnv, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "../../src/ai/anthropic";
import type { Env } from "../../src/env";

const env = rawEnv as unknown as Env;

/**
 * A fake Bot API at https://telegram.test (TELEGRAM_API_ROOT in vitest.config.ts).
 * The Durable Objects run in this same isolate, so stubbing fetch here
 * intercepts every Telegram call they make.
 */
const telegramCalls: Array<{ method: string; body: Record<string, any> }> = [];
const anthropicCalls: Array<{ path: string; headers: Headers; body: Record<string, any> }> = [];
let nextMessageId = 1;

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.anthropic.com") {
      anthropicCalls.push({ path: url.pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return Response.json({
        id: "msg_worker",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"question":"Who here would you trust with your phone?"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    if (url.hostname !== "telegram.test") return realFetch(input, init);
    const method = url.pathname.split("/").pop()!;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    telegramCalls.push({ method, body });
    return Response.json({ ok: true, result: fakeResult(method, body) });
  });
});

function fakeResult(method: string, body: Record<string, any>): unknown {
  switch (method) {
    case "sendMessage":
      return { message_id: nextMessageId++, date: 0, chat: { id: body.chat_id, type: "supergroup" }, text: body.text };
    case "getMe":
      return { id: 1, is_bot: true, first_name: "Bot", username: "TestGameBot" };
    case "getWebhookInfo":
      return { url: "https://example.workers.dev/webhook", has_custom_certificate: false, pending_update_count: 0 };
    case "getChatMember":
      // User 666 has left the group.
      return { status: body.user_id === 666 ? "left" : "member", user: { id: body.user_id, is_bot: false, first_name: "X" } };
    default:
      return true;
  }
}

let updateId = 1;
function playUpdate(chatId: number, text = "/play") {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "supergroup", title: "Friends" },
      from: { id: 101, is_bot: false, first_name: "Alice", username: "alice" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }],
    },
  };
}

function postUpdate(update: unknown, secret = "test-secret") {
  return exports.default.fetch("https://bot.example/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(update),
  });
}

describe("webhook endpoint", () => {
  it("rejects requests without Telegram's secret header", async () => {
    const response = await postUpdate(playUpdate(-1001), "wrong");
    expect(response.status).toBe(401);
    const missing = await exports.default.fetch("https://bot.example/webhook", { method: "POST", body: "{}" });
    expect(missing.status).toBe(401);
  });

  it("answers health checks and unknown paths", async () => {
    expect((await exports.default.fetch("https://bot.example/")).status).toBe(200);
    expect((await exports.default.fetch("https://bot.example/nope")).status).toBe(404);
  });

  it("routes an update to its chat's Durable Object, which opens a room", async () => {
    const chatId = -1002;
    const response = await postUpdate(playUpdate(chatId));
    expect(response.status).toBe(200);

    const sent = telegramCalls.filter((call) => call.method === "sendMessage" && call.body.chat_id === chatId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toContain("真心话大冒险");
    expect(sent[0]!.body.parse_mode).toBe("HTML");

    const stub = env.CHAT.getByName(String(chatId));
    const rooms = await runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql.exec("SELECT status, host_id FROM rooms").toArray(),
    );
    expect(rooms).toEqual([{ status: "lobby", host_id: 101 }]);
  });

  it("keeps each group's state separate", async () => {
    await postUpdate(playUpdate(-1003));
    await postUpdate(playUpdate(-1004));
    await postUpdate(playUpdate(-1004)); // second /play in the same group: "already open"
    const count = async (chatId: number) =>
      runInDurableObject(env.CHAT.getByName(String(chatId)), async (_instance, state) =>
        state.storage.sql.exec("SELECT COUNT(*) AS n FROM rooms").one().n,
      );
    expect(await count(-1003)).toBe(1);
    expect(await count(-1004)).toBe(1);
  });

  it("drops redelivered updates", async () => {
    const update = playUpdate(-1005);
    await postUpdate(update);
    await postUpdate(update);
    expect(telegramCalls.filter((call) => call.body.chat_id === -1005)).toHaveLength(1);
  });
});

describe("alarms", () => {
  it("schedule the idle timeout and close abandoned lobbies when they fire", async () => {
    const chatId = -1006;
    await postUpdate(playUpdate(chatId));
    const stub = env.CHAT.getByName(String(chatId));

    const alarm = await runInDurableObject(stub, async (_instance, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + 50 * 60 * 1000); // about an hour out

    // Pretend the hour has passed.
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE deadlines SET due_at = 0");
      state.storage.sql.exec("UPDATE rooms SET last_activity_at = 0");
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const room = await runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql.exec("SELECT status, end_reason FROM rooms").one(),
    );
    expect(room).toEqual({ status: "ended", end_reason: "idle" });
    expect(await runInDurableObject(stub, async (_instance, state) => state.storage.getAlarm())).toBeNull();
  });
});

describe("setup endpoint", () => {
  it("requires the webhook secret", async () => {
    const response = await exports.default.fetch("https://bot.example/setup", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("registers the webhook with its secret and publishes commands in both languages", async () => {
    const response = await exports.default.fetch("https://bot.example/setup", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, bot: "@TestGameBot" });

    const webhook = telegramCalls.find((call) => call.method === "setWebhook")!;
    expect(webhook.body).toMatchObject({
      url: "https://bot.example/webhook",
      secret_token: "test-secret",
      allowed_updates: ["message", "callback_query", "my_chat_member"],
    });
    const commands = telegramCalls.filter((call) => call.method === "setMyCommands");
    expect(commands.map((call) => call.body.language_code ?? "default")).toEqual(["default", "zh", "en"]);
  });
});

describe("Claude SDK inside the Workers runtime", () => {
  it("sends a request with the official SDK and parses the structured reply", async () => {
    const provider = anthropicProvider({ apiKey: "sk-worker" }); // global fetch, as in production
    const result = await provider.json({
      messages: [{ role: "user", content: "One truth question as JSON." }],
      schemaName: "prompt",
      schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    });
    expect(result).toEqual({ question: "Who here would you trust with your phone?" });
    expect(anthropicCalls).toHaveLength(1);
    expect(anthropicCalls[0]!.path).toBe("/v1/messages");
    expect(anthropicCalls[0]!.headers.get("authorization")).toBe("Bearer sk-worker");
    expect(anthropicCalls[0]!.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default" });
  });
});

// ------------------------------------------------------------------ Mini App

const BOT_TOKEN = "123:test-token"; // matches vitest.config.ts

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** Launch data as Telegram would sign it for the game page. */
async function signInitData(fields: Record<string, string>): Promise<string> {
  const encode = (text: string) => new Uint8Array(new TextEncoder().encode(text));
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = await hmac(encode("WebAppData"), encode(BOT_TOKEN));
  const hash = Array.from(await hmac(secret, encode(dataCheckString)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function launchFor(userId: number, chatId: number, roomId: number) {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    chat_type: "supergroup",
    start_param: `g${-chatId}r${roomId}`,
    user: JSON.stringify({ id: userId, first_name: userId === 101 ? "Alice" : "Someone" }),
  });
}

function login(body: unknown) {
  return exports.default.fetch("https://bot.example/app/api/session", { method: "POST", body: JSON.stringify(body) });
}

function openSocket(token: string) {
  return exports.default.fetch(`https://bot.example/app/ws?token=${encodeURIComponent(token)}`, { headers: { Upgrade: "websocket" } });
}

function nextMessage(ws: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }));
}

describe("Mini App", () => {
  // The page itself (/app) is served by Cloudflare's asset layer before the Worker runs, which
  // these tests bypass; test/unit/page.test.ts checks the files and wrangler.jsonc instead.
  it("leaves the page's paths to the asset layer", async () => {
    expect((await exports.default.fetch("https://bot.example/app")).status).toBe(404);
    expect((await exports.default.fetch("https://bot.example/app/api/session")).status).toBe(404); // GET: not a login
  });

  it("logs a group member in and streams their view of the room", async () => {
    const chatId = -1007;
    await postUpdate(playUpdate(chatId, "/guess"));
    const response = await login({ initData: await launchFor(101, chatId, 1) });
    expect(response.status).toBe(200);
    const { token, room } = await response.json<{ token: string; room: number }>();
    expect(room).toBe(1);

    const upgrade = await openSocket(token);
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket!;
    ws.accept();
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ a: "hello" }));
    expect(await first).toMatchObject({
      t: "view",
      view: { lang: "zh", me: { id: 101, isHost: true, isPlayer: true }, room: { id: 1, status: "lobby", title: "心照不宣" } },
    });

    // A tap that needs more players answers with a notice for this person only.
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ a: "start" }));
    expect(await reply).toEqual({ t: "toast", text: "至少要 3 个人才能开始" });
    ws.close(1000, "done");
  });

  it("turns away bad logins, outsiders, wrong rooms and forged sessions", async () => {
    const chatId = -1008;
    await postUpdate(playUpdate(chatId, "/guess"));
    expect((await login({ initData: "hash=00" })).status).toBe(401);
    expect((await login({})).status).toBe(401);
    expect((await login({ initData: await launchFor(666, chatId, 1) })).status).toBe(403); // left the group
    expect((await login({ initData: await launchFor(101, chatId, 9) })).status).toBe(403); // no such room
    expect((await login({ initData: await launchFor(101, -1999, 1) })).status).toBe(403); // a group the bot never saw

    const upgrade = await openSocket("forged.token");
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket!;
    const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
    ws.accept();
    expect(await closed).toBe(4001); // the page logs in again instead of retrying forever
  });
});
