import type { MessageEntity, Update } from "grammy/types";
import type { Llm } from "../../src/ai/llm";
import { ChatApp, type WebRequest } from "../../src/core/app";
import type { GameModule } from "../../src/core/game";
import type { Lang } from "../../src/core/i18n";
import { activeRoom, joinedPlayers, loadRoom, type Room } from "../../src/core/rooms";
import { migrate } from "../../src/core/schema";
import { GAMES } from "../../src/games";
import type { TodSettings, TodState, Turn } from "../../src/games/tod/types";
import { FakeTelegram } from "./fake-telegram";
import { nodeSql } from "./node-sql";

export const GROUP_ID = -1001234567890;

export interface Person {
  id: number;
  firstName: string;
  username?: string;
}

export const alice: Person = { id: 101, firstName: "Alice", username: "alice" };
export const bob: Person = { id: 102, firstName: "Bob", username: "bob" };
export const carol: Person = { id: 103, firstName: "Carol" }; // no username, like many real accounts
export const dave: Person = { id: 104, firstName: "Dave", username: "dave" };
export const erin: Person = { id: 105, firstName: "Erin <&>", username: "erin" }; // hostile name for escaping

/** Small deterministic PRNG so bottle spins are reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HarnessOptions {
  llm?: Llm | null;
  lang?: Lang;
  allowedChatIds?: number[];
  chatId?: number;
  seed?: number;
  /** Mini App short name; null = not configured. */
  webAppName?: string | null;
  /** The games on offer; the real list by default. Tests for a game that isn't registered (the template) pass their own. */
  games?: GameModule[];
}

export type Harness = ReturnType<typeof createHarness>;

export function createHarness(options: HarnessOptions = {}) {
  const sql = nodeSql();
  migrate(sql);
  const tg = new FakeTelegram();
  const chatId = options.chatId ?? GROUP_ID;
  let now = Date.UTC(2026, 10, 15, 20, 0, 0);
  let alarm: number | null = null;
  let updateId = 1;
  let messageId = 1;
  const migrations: Array<{ to: number }> = [];

  const app = new ChatApp({
    chatId,
    sql,
    tg,
    llm: options.llm ?? null,
    games: options.games ?? GAMES,
    config: {
      defaultLang: options.lang ?? "zh",
      allowedChatIds: options.allowedChatIds ? new Set(options.allowedChatIds) : null,
      webAppName: options.webAppName === undefined ? "play" : options.webAppName,
    },
    clock: () => now,
    random: seededRandom(options.seed ?? 7),
    setAlarm: async (at) => {
      alarm = at;
    },
    migrateTo: async (to) => {
      migrations.push({ to });
    },
  });

  const tgUser = (person: Person) => ({
    id: person.id,
    is_bot: false,
    first_name: person.firstName,
    ...(person.username ? { username: person.username } : {}),
  });

  /** Builds a message the way Telegram does: command and @mention entities included. */
  function messageUpdate(
    from: Person,
    text: string,
    extra: {
      replyTo?: Person;
      textMentions?: Array<{ person: Person; offset: number; length: number }>;
      chat?: "private";
      /** Forum topic the message was posted in. */
      threadId?: number;
    } = {},
  ): Update {
    const entities: MessageEntity[] = [];
    const command = /^\/\S+/.exec(text);
    if (command) entities.push({ type: "bot_command", offset: 0, length: command[0].length });
    for (const match of text.matchAll(/@[A-Za-z0-9_]{3,}/g)) {
      if (match.index === 0 || (command && match.index! < command[0].length)) continue;
      entities.push({ type: "mention", offset: match.index!, length: match[0].length });
    }
    for (const mention of extra.textMentions ?? []) {
      entities.push({ type: "text_mention", offset: mention.offset, length: mention.length, user: tgUser(mention.person) });
    }
    const isPrivate = extra.chat === "private";
    return {
      update_id: updateId++,
      message: {
        message_id: messageId++,
        date: Math.floor(now / 1000),
        chat: isPrivate
          ? { id: from.id, type: "private", first_name: from.firstName }
          : { id: chatId, type: "supergroup", title: "Friends" },
        from: tgUser(from),
        text,
        entities,
        ...(extra.threadId ? { is_topic_message: true, message_thread_id: extra.threadId } : {}),
        ...(extra.replyTo
          ? {
              reply_to_message: {
                message_id: messageId++,
                date: Math.floor(now / 1000),
                chat: { id: chatId, type: "supergroup", title: "Friends" },
                from: tgUser(extra.replyTo),
                text: "hi",
              },
            }
          : {}),
      },
    } as Update;
  }

  function callbackUpdate(from: Person, onMessage: number, data: string): Update {
    return {
      update_id: updateId++,
      callback_query: {
        id: `cb${updateId}`,
        from: tgUser(from),
        chat_instance: "ci",
        data,
        message: {
          message_id: onMessage,
          date: Math.floor(now / 1000),
          chat: { id: chatId, type: "supergroup", title: "Friends" },
          text: "",
        },
      },
    } as Update;
  }

  const h = {
    app,
    tg,
    sql,
    chatId,
    migrations,
    get alarm() {
      return alarm;
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    async fireAlarm(): Promise<void> {
      if (alarm !== null && alarm <= now) await app.handleAlarm();
    },
    send(update: Update) {
      return app.handleUpdate(update);
    },
    messageUpdate,
    callbackUpdate,
    async command(from: Person, text: string, extra?: Parameters<typeof messageUpdate>[2]) {
      await app.handleUpdate(messageUpdate(from, text, extra));
    },
    /** Taps the button whose label contains `label`; returns the toast/alert shown to that user. */
    async press(from: Person, onMessage: number | null | undefined, label: string) {
      const data = tg.buttonData(onMessage, label);
      await app.handleUpdate(callbackUpdate(from, onMessage!, data));
      return tg.lastAnswer();
    },
    async pressData(from: Person, onMessage: number, data: string) {
      await app.handleUpdate(callbackUpdate(from, onMessage, data));
      return tg.lastAnswer();
    },
    room(): Room<TodSettings, TodState> {
      const room = activeRoom(sql) ?? loadRoom(sql, Number(sql.first<{ id: number }>("SELECT MAX(id) AS id FROM rooms")?.id));
      if (!room) throw new Error("no room");
      return room as Room<TodSettings, TodState>;
    },
    turn(): Turn {
      const turn = h.room().state?.turn;
      if (!turn) throw new Error("no turn");
      return turn;
    },
    players(): number[] {
      return joinedPlayers(sql, h.room().id);
    },
    roomMessage() {
      return tg.message(h.room().messageId);
    },
    turnCard() {
      return tg.message(h.turn().messageId);
    },
    /** Mini App: opens the game page as `person` (membership check included). */
    webJoin(person: Person, roomId = h.room().id) {
      return app.webJoin({ id: person.id, isBot: false, firstName: person.firstName, username: person.username }, roomId);
    },
    /** Mini App: what `person`'s game page shows right now. */
    view(person: Person, roomId = h.room().id) {
      return app.webView(person.id, roomId);
    },
    /** Mini App: a tap in the game page; resolves to the notice `person` would see, if any. */
    web(person: Person, request: WebRequest, roomId = h.room().id) {
      return app.webAction(person.id, roomId, request);
    },
  };
  return h;
}

export const PEOPLE = [alice, bob, carol, dave, erin];

export function personById(id: number): Person {
  const person = PEOPLE.find((candidate) => candidate.id === id);
  if (!person) throw new Error(`unknown person ${id}`);
  return person;
}

/** Builds `/invite ...` text with @username mentions and text mentions for people without usernames. */
export function inviteCommand(people: Person[]): { text: string; textMentions: Array<{ person: Person; offset: number; length: number }> } {
  let text = "/invite";
  const textMentions: Array<{ person: Person; offset: number; length: number }> = [];
  for (const person of people) {
    text += " ";
    if (person.username) {
      text += `@${person.username}`;
    } else {
      textMentions.push({ person, offset: text.length, length: person.firstName.length });
      text += person.firstName;
    }
  }
  return { text, textMentions };
}

/** Opens a room as Alice and brings `others` in through invitations, then optionally starts. */
export async function roomWith(h: Harness, others: Person[], start = true): Promise<void> {
  await h.command(alice, "/play");
  if (others.length) {
    const { text, textMentions } = inviteCommand(others);
    await h.command(alice, text, { textMentions });
    const invite = h.tg.findWithButton("接受") ?? h.tg.findWithButton("Accept");
    for (const person of others) await h.press(person, invite!.id, invite!.keyboard.flat()[0]!.text);
  }
  if (start) await h.press(alice, h.room().messageId, h.tg.labels(h.room().messageId).find((label) => label === "开始" || label === "Start")!);
}
