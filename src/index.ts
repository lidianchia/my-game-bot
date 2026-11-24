import { Api } from "grammy/web";
import type { BotCommand, Update } from "grammy/types";
import type { Env } from "./env";
import { routeChatId } from "./routing";
import { verifyInitData } from "./web/init-data";
import { CLOSE_SESSION_EXPIRED } from "./web/protocol";
import { SESSION_MS, signSession, verifySession } from "./web/session";
import { parseStartParam } from "./web/start-param";

export { ChatDurableObject } from "./chat-object";

/** Update types the bot consumes; everything else Telegram can send is filtered out at the source. */
const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;

const COMMANDS: Record<"zh" | "en", BotCommand[]> = {
  zh: [
    { command: "play", description: "开一局真心话大冒险" },
    { command: "guess", description: "开一局心照不宣（猜词，在 Mini App 里玩）" },
    { command: "invite", description: "邀请玩家（@用户名 或回复消息）" },
    { command: "kick", description: "把玩家请出房间（房主）" },
    { command: "end", description: "结束本局（房主或管理员）" },
    { command: "log", description: "本局完整记录" },
    { command: "stats", description: "历史统计" },
    { command: "lang", description: "切换语言 / Switch language" },
    { command: "help", description: "玩法说明" },
  ],
  en: [
    { command: "play", description: "Start a game of Truth or Dare" },
    { command: "guess", description: "Start Unsaid, a word game played in the Mini App" },
    { command: "invite", description: "Invite players (@username or reply)" },
    { command: "kick", description: "Remove a player (host)" },
    { command: "end", description: "End the game (host or admin)" },
    { command: "log", description: "Full log of this game" },
    { command: "stats", description: "All-time stats" },
    { command: "lang", description: "Switch language / 切换语言" },
    { command: "help", description: "How to play" },
  ],
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") return handleWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/setup") return handleSetup(request, env, url);
    // The game page itself (/app) is a static asset; these two are its backend.
    if (request.method === "POST" && url.pathname === "/app/api/session") return handleSession(request, env);
    if (request.method === "GET" && url.pathname === "/app/ws") return handleSocket(request, env, url);
    if (request.method === "GET" && url.pathname === "/") return new Response("my-game-bot is running\n");
    return new Response("Not found\n", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!(await secretMatches(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET))) {
    return new Response("Unauthorized\n", { status: 401 });
  }
  let update: Update;
  try {
    update = await request.json<Update>();
  } catch {
    return new Response("Bad request\n", { status: 400 });
  }
  const chatId = routeChatId(update);
  if (chatId === null) return new Response("ok");
  try {
    await env.CHAT.getByName(String(chatId)).handleUpdate(chatId, update);
  } catch (error) {
    // Acknowledge anyway: a failing update that Telegram keeps redelivering would
    // hold up every update queued behind it.
    console.error("update failed", update.update_id, error);
  }
  return new Response("ok");
}

/**
 * One-time setup after deploying: registers this Worker as the webhook and
 * publishes the command menu in both languages.
 *   curl -X POST https://<worker>/setup -H "Authorization: Bearer $WEBHOOK_SECRET"
 */
async function handleSetup(request: Request, env: Env, url: URL): Promise<Response> {
  const given = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(await secretMatches(given, env.WEBHOOK_SECRET))) return new Response("Unauthorized\n", { status: 401 });

  const api = new Api(env.BOT_TOKEN, { apiRoot: env.TELEGRAM_API_ROOT || undefined });
  const webhookUrl = `${url.origin}/webhook`;
  await api.setWebhook(webhookUrl, {
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: [...ALLOWED_UPDATES],
    drop_pending_updates: url.searchParams.get("drop") === "1",
  });
  await api.setMyCommands(COMMANDS.zh);
  await api.setMyCommands(COMMANDS.zh, { language_code: "zh" });
  await api.setMyCommands(COMMANDS.en, { language_code: "en" });
  const [me, info] = await Promise.all([api.getMe(), api.getWebhookInfo()]);
  return Response.json({ ok: true, bot: `@${me.username}`, webhook: info.url, pending: info.pending_update_count });
}

/**
 * The game page posts the initData Telegram signed for it. If the signature
 * checks out and the person belongs to the group the link points at, they get
 * a session token for the WebSocket.
 */
async function handleSession(request: Request, env: Env): Promise<Response> {
  let body: { initData?: unknown; room?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    // Treated as missing initData below.
  }
  const initData = typeof body?.initData === "string" ? body.initData : "";
  const verified = await verifyInitData(initData, env.BOT_TOKEN, Date.now());
  if (!verified) return Response.json({ error: "auth" }, { status: 401 });
  const target = parseStartParam(verified.startParam);
  if (!target) return Response.json({ error: "link" }, { status: 400 });

  // After a game ends, the page may move on to the same group's next room.
  const requestedRoom = body?.room;
  const roomId =
    typeof requestedRoom === "number" && Number.isSafeInteger(requestedRoom) && requestedRoom > 0 ? requestedRoom : target.roomId;
  const joined = await env.CHAT.getByName(String(target.chatId)).webJoin(target.chatId, verified.user, roomId);
  if (!joined.ok) return Response.json({ error: joined.reason }, { status: 403 });

  const token = await signSession(
    { userId: verified.user.id, chatId: target.chatId, roomId, expiresAt: Date.now() + SESSION_MS },
    env.WEBHOOK_SECRET,
  );
  return Response.json({ token, room: roomId });
}

/** Opens the game page's live connection to its group's Durable Object. */
async function handleSocket(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket\n", { status: 426 });
  }
  const session = await verifySession(url.searchParams.get("token"), env.WEBHOOK_SECRET, Date.now());
  if (!session) {
    // A refused handshake looks like a network error to the page; a close code tells it to log in again.
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].close(CLOSE_SESSION_EXPIRED, "session expired");
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  // Identity travels in headers only the Worker can set; whatever the page sent under these names is overwritten.
  const headers = new Headers(request.headers);
  headers.set("X-Session-User", String(session.userId));
  headers.set("X-Session-Room", String(session.roomId));
  return env.CHAT.getByName(String(session.chatId)).fetch(new Request(request.url, { headers }));
}

/** Constant-time comparison so the secret can't be guessed byte by byte from response timing. */
async function secretMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
