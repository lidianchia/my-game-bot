import { DurableObject } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { createLlm } from "./ai/llm";
import { ChatApp, type WebJoinResult, type WebRequest } from "./core/app";
import { getKv, setKv } from "./core/kv";
import { migrate } from "./core/schema";
import { importSnapshot, type ChatSnapshot } from "./core/snapshot";
import { appConfig } from "./config";
import type { Env } from "./env";
import { GAMES } from "./games";
import { durableObjectSql } from "./platform/do-sql";
import type { Sql } from "./platform/sql";
import type { TgUser } from "./telegram/intents";
import { createTelegramPort } from "./telegram/grammy-port";
import type { ClientMessage, ServerMessage } from "./web/protocol";

/** Who is on the other end of a game-page WebSocket; survives hibernation as the socket's attachment. */
interface SocketInfo {
  userId: number;
  roomId: number;
}

const MAX_SOCKET_MESSAGE_CHARS = 4096;
/** A page sending more than this many messages in the window is ignored for the rest of it. */
const SOCKET_BURST = 15;
const SOCKET_WINDOW_MS = 3000;

/**
 * One instance per Telegram chat. Updates, alarms and game-page actions run
 * strictly one at a time through `serialized`, because a handler awaits
 * Telegram/AI calls and the runtime would otherwise interleave two presses.
 *
 * Game pages (the Mini App) connect over hibernatable WebSockets: the object
 * can sleep between moves while the sockets stay open.
 */
export class ChatDurableObject extends DurableObject<Env> {
  private readonly sql: Sql;
  private queue: Promise<unknown> = Promise.resolve();
  private app: ChatApp | null = null;
  /** Last view sent on each socket, so a change elsewhere doesn't resend identical views. */
  private readonly lastSent = new WeakMap<WebSocket, string>();
  private readonly recentMessages = new WeakMap<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableObjectSql(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql);
    });
  }

  /** RPC from the Worker: one Telegram update for this chat. */
  handleUpdate(chatId: number, update: Update): Promise<void> {
    return this.serialized(async () => {
      if (getKv(this.sql, "chat_id") === null) setKv(this.sql, "chat_id", String(chatId));
      try {
        await this.appFor(chatId).handleUpdate(update);
      } finally {
        this.pushViews();
      }
    });
  }

  /** RPC from the basic group this supergroup was upgraded from. */
  importSnapshot(snapshot: ChatSnapshot): Promise<boolean> {
    return this.serialized(async () => importSnapshot(this.sql, snapshot));
  }

  /** RPC from the Worker: a verified Telegram user opened this group's game page. */
  webJoin(chatId: number, user: TgUser, roomId: number): Promise<WebJoinResult> {
    return this.serialized(async (): Promise<WebJoinResult> => {
      // A group this object has never heard from has no rooms; don't adopt its id on a page's say-so.
      if (Number(getKv(this.sql, "chat_id")) !== chatId) return { ok: false, reason: "room" };
      return this.appFor(chatId).webJoin(user, roomId);
    });
  }

  override async alarm(): Promise<void> {
    await this.serialized(async () => {
      const chatId = Number(getKv(this.sql, "chat_id"));
      if (!chatId) return;
      try {
        await this.appFor(chatId).handleAlarm();
      } finally {
        this.pushViews();
      }
    });
  }

  /** Game-page WebSocket upgrades, forwarded by the Worker once it has checked the session token. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket\n", { status: 426 });
    }
    const userId = Number(request.headers.get("X-Session-User"));
    const roomId = Number(request.headers.get("X-Session-Room"));
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(roomId) || roomId <= 0) {
      return new Response("Bad session\n", { status: 400 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, roomId } satisfies SocketInfo);
    // The page says hello once it's open and gets its first view in reply.
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const info = ws.deserializeAttachment() as SocketInfo | null;
    if (!info || typeof message !== "string" || message.length > MAX_SOCKET_MESSAGE_CHARS) return;
    if (this.flooding(ws)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const request = parsed;

    await this.serialized(async () => {
      const chatId = Number(getKv(this.sql, "chat_id"));
      if (!chatId) return;
      try {
        if (request.a === "hello") {
          this.lastSent.delete(ws); // always answer a hello with a full view
        } else {
          const notice = await this.appFor(chatId).webAction(info.userId, info.roomId, request as WebRequest);
          if (notice) send(ws, { t: "toast", text: notice });
        }
      } finally {
        this.pushViews();
      }
    });
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed; nothing to complete.
    }
  }

  override async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.warn("game page socket error", error);
  }

  /** Sends every connected game page its current view, skipping pages whose view hasn't changed. */
  private pushViews(): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const chatId = Number(getKv(this.sql, "chat_id"));
    if (!chatId) return;
    const app = this.appFor(chatId);
    const now = Date.now();
    for (const ws of sockets) {
      const info = ws.deserializeAttachment() as SocketInfo | null;
      if (!info) continue;
      let view;
      try {
        view = app.webView(info.userId, info.roomId);
      } catch (error) {
        console.error("rendering a game page failed", info, error);
        continue;
      }
      if (!view) {
        send(ws, { t: "gone", reason: "room" });
        continue;
      }
      const json = JSON.stringify(view);
      if (this.lastSent.get(ws) === json) continue;
      this.lastSent.set(ws, json);
      send(ws, { t: "view", now, view });
    }
  }

  private flooding(ws: WebSocket): boolean {
    const now = Date.now();
    const recent = (this.recentMessages.get(ws) ?? []).filter((at) => now - at < SOCKET_WINDOW_MS);
    recent.push(now);
    this.recentMessages.set(ws, recent);
    return recent.length > SOCKET_BURST;
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private appFor(chatId: number): ChatApp {
    this.app ??= new ChatApp({
      chatId,
      sql: this.sql,
      tg: createTelegramPort(this.env.BOT_TOKEN, this.env.TELEGRAM_API_ROOT),
      llm: createLlm(this.env),
      games: GAMES,
      config: appConfig(this.env),
      clock: () => Date.now(),
      random: () => Math.random(),
      setAlarm: async (at) => {
        if (at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(at);
      },
      migrateTo: async (newChatId, snapshot) => {
        await this.env.CHAT.getByName(String(newChatId)).importSnapshot(snapshot);
      },
    });
    return this.app;
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The page went away mid-send; it will get a fresh view when it reconnects.
  }
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  switch (record.a) {
    case "hello":
    case "join":
    case "start":
      return true;
    case "set":
      return typeof record.key === "string" && record.key.length <= 16 && typeof record.value === "string" && record.value.length <= 16;
    case "approve":
    case "deny":
      return Number.isSafeInteger(record.request);
    case "g":
      return typeof record.op === "string" && record.op.length <= 16;
    default:
      return false;
  }
}
