import type { Update } from "grammy/types";
import type { Llm } from "../ai/llm";
import type { Sql } from "../platform/sql";
import { groupScopedCallback, stripGroupScope } from "../routing";
import { parseRoomCallback, roomCallback } from "../telegram/callback";
import { esc, mentionHtml, splitForTelegram } from "../telegram/html";
import { parseUpdate, usersSeenIn, type Intent, type TgUser } from "../telegram/intents";
import { button, urlButton, type Keyboard, type SendOptions, type TelegramPort } from "../telegram/port";
import { G } from "../ui/glyphs";
import { cancelDeadlines, nextDeadlineAt, scheduleDeadline, takeDueDeadlines } from "./deadlines";
import type { ClientMessage, WebView } from "../web/protocol";
import { webStartParam } from "../web/start-param";
import type { CallbackReply, GameContext, GameModule, WebAction } from "./game";
import { coreMessages, parseLang, type CoreMessages, type Lang } from "./i18n";
import { getKv, setKv } from "./kv";
import { displayName, findMemberByUsername, getMember, markDmReachable, nameOf, recentMembers } from "./members";
import { rememberUser } from "./members";
import {
  activeRoom,
  addInvitation,
  addPlayer,
  batchInvitations,
  cancelPendingInvitations,
  cancelPendingRequests,
  createInviteBatch,
  createJoinRequest,
  createPicker,
  createRoom,
  decideJoinRequest,
  deletePicker,
  everyPlayer,
  getJoinRequest,
  getPicker,
  hasPendingInvitation,
  invitationFor,
  inviteBatch,
  isJoined,
  joinedPlayers,
  latestPlayedRoom,
  loadRoom,
  pendingInvitations,
  pendingRequestFor,
  pendingRequests,
  respondToInvitation,
  saveRoom,
  savePickerSelection,
  setInviteBatchMessage,
  setPlayerStatus,
  setRequestMessage,
  type EndReason,
  type Invitation,
  type PickerMode,
  type Room,
  type RoomView,
} from "./rooms";
import { exportSnapshot, type ChatSnapshot } from "./snapshot";
import { appendLog } from "./turn-log";

type CommandIntent = Extract<Intent, { type: "command" }>;
type CallbackIntent = Extract<Intent, { type: "callback" }>;

export interface AppConfig {
  defaultLang: Lang;
  /** null = the bot plays in any group. */
  allowedChatIds: ReadonlySet<number> | null;
  /** Short name of the bot's Mini App (BotFather /newapp); null = games played in the Mini App are unavailable. */
  webAppName: string | null;
}

export type WebJoinResult = { ok: true } | { ok: false; reason: "room" | "member" };

/** A Mini App message other than the initial hello. */
export type WebRequest = Exclude<ClientMessage, { a: "hello" }>;

export interface AppDeps {
  /** The chat this object owns: a group (negative id) or a user's private chat. */
  chatId: number;
  sql: Sql;
  tg: TelegramPort;
  llm: Llm | null;
  games: GameModule[];
  config: AppConfig;
  clock: () => number;
  random: () => number;
  setAlarm: (at: number | null) => Promise<void>;
  /** Hands this chat's history to the supergroup it was upgraded into. */
  migrateTo?: (newChatId: number, snapshot: ChatSnapshot) => Promise<void>;
}

/** A lobby nobody starts closes after an hour; a game nobody touches ends after three. */
export const LOBBY_IDLE_MS = 60 * 60 * 1000;
export const PLAYING_IDLE_MS = 3 * 60 * 60 * 1000;
const PICKER_LIMIT = 16;
const PROCESSED_UPDATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Someone named in /invite or /kick, resolved as far as the bot can. */
interface Target {
  userId: number | null;
  username: string | null;
  label: string;
}

/**
 * Everything that happens in one chat. A Durable Object owns one instance and
 * feeds it updates and alarms one at a time, so no handler ever races another.
 */
export class ChatApp {
  private alarmAt: number | null | undefined;

  constructor(private readonly deps: AppDeps) {}

  // ------------------------------------------------------------ entry points

  async handleUpdate(update: Update): Promise<void> {
    if (this.seenBefore(update.update_id)) return;
    const now = this.now();
    for (const user of usersSeenIn(update)) rememberUser(this.sql, user, now);
    try {
      const intent = parseUpdate(update, await this.botUsernameFor(update));
      if (this.isGroupChat && !this.isAllowedChat()) {
        await this.refuseChat(intent);
        return;
      }
      await this.dispatch(intent);
    } finally {
      await this.syncAlarm();
    }
  }

  async handleAlarm(): Promise<void> {
    try {
      for (const deadline of takeDueDeadlines(this.sql, this.now())) {
        const room = loadRoom(this.sql, deadline.roomId);
        if (!room || room.status === "ended") continue;
        try {
          if (deadline.kind === "idle") await this.checkIdle(room);
          else await this.game(room.game).onDeadline(this.gameContext(room), deadline.kind, deadline.data);
        } catch (error) {
          console.error("deadline failed", deadline, error);
        } finally {
          saveRoom(this.sql, room);
        }
      }
    } finally {
      await this.syncAlarm();
    }
  }

  // ------------------------------------------------------------- plumbing

  private get sql(): Sql {
    return this.deps.sql;
  }

  private get isGroupChat(): boolean {
    return this.deps.chatId < 0;
  }

  private now(): number {
    return this.deps.clock();
  }

  private lang(): Lang {
    return parseLang(getKv(this.sql, "lang")) ?? this.deps.config.defaultLang;
  }

  private m(): CoreMessages {
    return coreMessages[this.lang()];
  }

  private game(id: string): GameModule {
    const game = this.findGame(id);
    if (!game) throw new Error(`unknown game ${id}`);
    return game;
  }

  private findGame(id: string): GameModule | undefined {
    return this.deps.games.find((candidate) => candidate.id === id);
  }

  private nameHtml(userId: number): string {
    return esc(nameOf(this.sql, userId));
  }

  private mentionOf(userId: number): string {
    return mentionHtml(userId, nameOf(this.sql, userId));
  }

  private send(html: string, options: SendOptions = {}): Promise<number> {
    return this.deps.tg.sendMessage(this.deps.chatId, html, options);
  }

  private replyTo(cmd: CommandIntent, html: string): Promise<number> {
    return this.send(html, { threadId: cmd.threadId, replyTo: cmd.messageId });
  }

  /** Telegram may redeliver an update after a timeout; acting twice would double-vote or double-send. */
  private seenBefore(updateId: number): boolean {
    if (this.sql.first(`SELECT 1 AS yes FROM processed_updates WHERE update_id = ?`, updateId)) return true;
    const now = this.now();
    this.sql.run(`INSERT INTO processed_updates (update_id, seen_at) VALUES (?, ?)`, updateId, now);
    if (updateId % 50 === 0) {
      this.sql.run(`DELETE FROM processed_updates WHERE seen_at < ?`, now - PROCESSED_UPDATE_TTL_MS);
    }
    return false;
  }

  private async botUsername(): Promise<string> {
    const cached = getKv(this.sql, "bot_username");
    if (cached) return cached;
    const username = await this.deps.tg.getBotUsername();
    setKv(this.sql, "bot_username", username);
    return username;
  }

  /** Only `/command@SomeBot` needs our username to decide who it's for; skip the API call otherwise. */
  private async botUsernameFor(update: Update): Promise<string | null> {
    const cached = getKv(this.sql, "bot_username");
    if (cached) return cached;
    return /^\/\w+@/.test(update.message?.text ?? "") ? this.botUsername() : null;
  }

  private async syncAlarm(): Promise<void> {
    const next = nextDeadlineAt(this.sql);
    if (next === this.alarmAt) return;
    await this.deps.setAlarm(next);
    this.alarmAt = next;
  }

  private isAllowedChat(): boolean {
    const allowed = this.deps.config.allowedChatIds;
    return !allowed || allowed.has(this.deps.chatId);
  }

  private async refuseChat(intent: Intent): Promise<void> {
    if (intent.type !== "bot-added" && intent.type !== "command") return;
    await this.send(this.m().notAllowed(this.deps.chatId));
    try {
      await this.deps.tg.leaveChat(this.deps.chatId);
    } catch (error) {
      console.warn("leaveChat failed", error);
    }
  }

  private async isAdmin(userId: number): Promise<boolean> {
    const status = await this.deps.tg.getChatMemberStatus(this.deps.chatId, userId);
    return status === "creator" || status === "administrator";
  }

  private helpText(): string {
    const lang = this.lang();
    return [...this.deps.games.map((game) => game.helpText(lang)), this.m().helpCommands].join("\n\n");
  }

  private callbackReply(callbackId: string): CallbackReply {
    let answered = false;
    return {
      answer: async (text?: string, alert?: boolean) => {
        if (answered) return;
        answered = true;
        await this.deps.tg.answerCallback(callbackId, text, alert);
      },
    };
  }

  // ------------------------------------------------------------- dispatch

  private async dispatch(intent: Intent): Promise<void> {
    switch (intent.type) {
      case "command":
        return this.onCommand(intent);
      case "callback":
        return this.onCallback(intent);
      case "bot-added":
        await this.send(this.m().groupWelcome);
        return;
      case "migrated":
        return this.onMigrated(intent.toChatId);
      default:
        return;
    }
  }

  private async onCommand(cmd: CommandIntent): Promise<void> {
    const m = this.m();
    if (cmd.chatKind === "private") {
      if (this.isGroupChat) {
        // `/start g<chatId>` deep link from a group button: this player can now get DMs.
        markDmReachable(this.sql, cmd.from.id, true);
        await this.deps.tg.sendDirect(cmd.from.id, m.dmLinked);
        return;
      }
      await this.send(cmd.command === "help" ? this.helpText() : m.privateWelcome);
      return;
    }
    switch (cmd.command) {
      case "play":
        return this.cmdPlay(cmd, cmd.args.split(/\s+/)[0]?.toLowerCase() || null);
      case "invite":
        return this.cmdInvite(cmd);
      case "kick":
        return this.cmdKick(cmd);
      case "end":
      case "stop":
        return this.cmdEnd(cmd);
      case "log":
        return this.cmdLog(cmd);
      case "stats":
        return this.cmdStats(cmd);
      case "lang":
      case "language":
        return this.cmdLang(cmd);
      case "help":
      case "start":
        await this.replyTo(cmd, this.helpText());
        return;
      default:
        // A game's id doubles as a shortcut: /tod, /guess.
        if (this.findGame(cmd.command)) return this.cmdPlay(cmd, cmd.command);
        return; // someone else's command
    }
  }

  private async onCallback(cb: CallbackIntent): Promise<void> {
    const m = this.m();
    const reply = this.callbackReply(cb.callbackId);
    try {
      const parsed = parseRoomCallback(stripGroupScope(cb.data));
      const room = parsed ? loadRoom(this.sql, parsed.roomId) : undefined;
      if (!parsed || !room) {
        await reply.answer(m.staleButton);
        return;
      }
      if (room.status === "ended") {
        await reply.answer(m.roomGone);
        return;
      }
      try {
        room.lastActivityAt = this.now();
        await this.onRoomAction(room, parsed.action, parsed.args, cb, reply);
      } finally {
        saveRoom(this.sql, room);
      }
    } catch (error) {
      console.error("callback failed", cb.data, error);
      await reply.answer(m.somethingWrong);
    } finally {
      await reply.answer();
    }
  }

  private async onRoomAction(
    room: Room,
    action: string,
    args: string[],
    cb: CallbackIntent,
    reply: CallbackReply,
  ): Promise<void> {
    const m = this.m();
    const from = cb.from;
    const hostOnly = async (run: () => Promise<void>) => {
      if (from.id !== room.hostId) await reply.answer(m.hostOnly);
      else await run();
    };
    const hostOrAdmin = async (run: () => Promise<void>) => {
      if (from.id === room.hostId || (await this.isAdmin(from.id))) await run();
      else await reply.answer(m.hostOrAdminOnly);
    };

    switch (action) {
      case "j":
        return this.requestJoin(room, from, reply);
      case "lv":
        return this.leave(room, from, reply);
      case "ia":
      case "id":
        return this.answerInvite(room, Number(args[0]), action === "ia", from, reply);
      case "ra":
      case "rd":
        return hostOnly(() => this.decideRequest(room, Number(args[0]), action === "ra", reply));
      case "inv":
        return hostOnly(() => this.openPicker(room, "invite", reply));
      case "kk":
        return hostOnly(() => this.openPicker(room, "kick", reply));
      case "pk":
        return hostOnly(() => this.togglePick(room, cb.messageId, Number(args[0]), reply));
      case "ps":
        return hostOnly(() => this.submitPicker(room, cb.messageId, reply));
      case "pc":
        return hostOnly(() => this.closePicker(cb.messageId, reply));
      case "set":
        return hostOnly(() => this.showView(room, "settings"));
      case "back":
        return hostOnly(() => this.showView(room, "main"));
      case "st":
        return hostOnly(() => this.changeSetting(room, args, reply));
      case "lang":
        return hostOnly(() => this.changeLanguage(room, args[0]));
      case "go":
        return hostOnly(() => this.startGame(room, reply));
      case "skip":
        return hostOnly(() => this.skipTurn(room, from.id, reply));
      case "end":
        return hostOrAdmin(() => this.showView(room, "confirm-end"));
      case "endn":
        // Backing out is harmless, and a host who walks away mid-confirm shouldn't freeze the buttons.
        return this.showView(room, "main");
      case "endy":
        return hostOrAdmin(async () => {
          await reply.answer();
          const reason: EndReason = room.status === "lobby" ? "disbanded" : from.id === room.hostId ? "host" : "admin";
          await this.endRoom(room, reason);
        });
      case "g":
        if (room.status !== "playing") {
          await reply.answer(m.gameNotStarted);
          return;
        }
        return this.game(room.game).onAction(this.gameContext(room), args, from, reply);
      default:
        await reply.answer(m.staleButton);
    }
  }

  // ------------------------------------------------------------- commands

  private async cmdPlay(cmd: CommandIntent, requested: string | null): Promise<void> {
    const m = this.m();
    const open = activeRoom(this.sql);
    if (open) {
      await this.send(m.roomAlreadyOpen, { threadId: open.threadId, replyTo: open.messageId ?? cmd.messageId });
      return;
    }
    const game = requested ? this.findGame(requested) : this.deps.games[0];
    if (!game) {
      const list = this.deps.games.map((candidate) => `<code>${candidate.id}</code> ${esc(candidate.title(this.lang()))}`);
      await this.replyTo(cmd, m.unknownGame(list.join(m.sep)));
      return;
    }
    if (game.web) {
      if (!this.deps.config.webAppName) {
        await this.replyTo(cmd, m.webAppMissing);
        return;
      }
      await this.botUsername(); // the room message links to t.me/<bot>/<app>
    }
    const now = this.now();
    const room = createRoom(this.sql, {
      game: game.id,
      hostId: cmd.from.id,
      threadId: cmd.threadId,
      settings: game.defaultSettings(this.deps.llm !== null),
      now,
    });
    addPlayer(this.sql, room.id, cmd.from.id, now);
    scheduleDeadline(this.sql, room.id, "idle", now + LOBBY_IDLE_MS);
    const view = this.renderRoom(room);
    room.messageId = await this.send(view.text, { keyboard: view.keyboard, threadId: room.threadId });
    saveRoom(this.sql, room);
  }

  private async cmdInvite(cmd: CommandIntent): Promise<void> {
    const m = this.m();
    const room = activeRoom(this.sql);
    if (!room) {
      await this.replyTo(cmd, m.noRoom);
      return;
    }
    if (cmd.from.id !== room.hostId) {
      await this.replyTo(cmd, m.hostOnly);
      return;
    }
    const targets = this.targetsOf(cmd);
    if (targets.length === 0) {
      await this.replyTo(cmd, m.inviteUsage);
      return;
    }
    try {
      room.lastActivityAt = this.now();
      const invited = await this.invite(room, targets, cmd.from.id);
      if (invited === 0) await this.replyTo(cmd, m.inviteNobodyNew);
    } finally {
      saveRoom(this.sql, room);
    }
  }

  private async cmdKick(cmd: CommandIntent): Promise<void> {
    const m = this.m();
    const room = activeRoom(this.sql);
    if (!room) {
      await this.replyTo(cmd, m.noRoom);
      return;
    }
    if (cmd.from.id !== room.hostId) {
      await this.replyTo(cmd, m.hostOnly);
      return;
    }
    const targets = this.targetsOf(cmd);
    if (targets.length === 0) {
      await this.replyTo(cmd, m.kickUsage);
      return;
    }
    try {
      room.lastActivityAt = this.now();
      let kicked = 0;
      for (const target of targets) {
        if (target.userId === null || target.userId === room.hostId) continue;
        if (!isJoined(this.sql, room.id, target.userId)) continue;
        await this.removeFromRoom(room, target.userId, "kicked");
        kicked += 1;
      }
      if (kicked === 0) await this.replyTo(cmd, m.kickNotPlayer);
      else await this.refreshRoomMessage(room);
    } finally {
      saveRoom(this.sql, room);
    }
  }

  private async cmdEnd(cmd: CommandIntent): Promise<void> {
    const m = this.m();
    const room = activeRoom(this.sql);
    if (!room) {
      await this.replyTo(cmd, m.noRoom);
      return;
    }
    const isHost = cmd.from.id === room.hostId;
    if (!isHost && !(await this.isAdmin(cmd.from.id))) {
      await this.replyTo(cmd, m.hostOrAdminOnly);
      return;
    }
    try {
      await this.endRoom(room, room.status === "lobby" ? "disbanded" : isHost ? "host" : "admin");
    } finally {
      saveRoom(this.sql, room);
    }
  }

  private async cmdLog(cmd: CommandIntent): Promise<void> {
    const open = activeRoom(this.sql);
    const room = open?.startedAt ? open : latestPlayedRoom(this.sql);
    if (!room) {
      await this.replyTo(cmd, this.m().logEmpty);
      return;
    }
    const text = this.game(room.game).renderLog(this.gameContext(room));
    const chunks = splitForTelegram(text);
    for (const [index, chunk] of chunks.entries()) {
      await this.send(chunk, { threadId: cmd.threadId, replyTo: index === 0 ? cmd.messageId : undefined });
    }
  }

  private async cmdStats(cmd: CommandIntent): Promise<void> {
    const focus = this.targetsOf(cmd)[0]?.userId ?? null;
    const lang = this.lang();
    const sections = this.deps.games
      .map((game) => game.renderStats(this.sql, lang, (userId) => nameOf(this.sql, userId), focus))
      .filter((section): section is string => !!section);
    const text = sections.length ? sections.join("\n\n") : this.m().statsEmpty;
    const chunks = splitForTelegram(text);
    for (const [index, chunk] of chunks.entries()) {
      await this.send(chunk, { threadId: cmd.threadId, replyTo: index === 0 ? cmd.messageId : undefined });
    }
  }

  private async cmdLang(cmd: CommandIntent): Promise<void> {
    const next = parseLang(cmd.args) ?? (this.lang() === "zh" ? "en" : "zh");
    setKv(this.sql, "lang", next);
    await this.replyTo(cmd, coreMessages[next].langSwitched);
    const room = activeRoom(this.sql);
    if (room) {
      await this.refreshRoomMessage(room);
      saveRoom(this.sql, room);
    }
  }

  /** People named by a reply and/or @mentions; unknown usernames stay unresolved until they tap a button. */
  private targetsOf(cmd: CommandIntent): Target[] {
    const targets: Target[] = [];
    const fromUser = (user: TgUser) => {
      if (!user.isBot) targets.push({ userId: user.id, username: user.username ?? null, label: displayName(user) });
    };
    if (cmd.replyToUser) fromUser(cmd.replyToUser);
    for (const mention of cmd.mentions) {
      if (mention.kind === "user") {
        fromUser(mention.user);
        continue;
      }
      const known = findMemberByUsername(this.sql, mention.username);
      targets.push(
        known
          ? { userId: known.userId, username: known.username, label: displayName(known) }
          : { userId: null, username: mention.username, label: `@${mention.username}` },
      );
    }
    const seen = new Set<string>();
    return targets.filter((target) => {
      const key = target.userId !== null ? `id:${target.userId}` : `name:${target.username?.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ------------------------------------------------------- joining a room

  private async invite(room: Room, targets: Target[], invitedBy: number): Promise<number> {
    const now = this.now();
    const botName = getKv(this.sql, "bot_username")?.toLowerCase();
    const fresh = targets.filter((target) => {
      if (target.userId === invitedBy) return false;
      if (target.username && botName && target.username.toLowerCase() === botName) return false;
      if (target.userId !== null && isJoined(this.sql, room.id, target.userId)) return false;
      return !hasPendingInvitation(this.sql, room.id, { id: target.userId ?? -1, username: target.username });
    });
    if (fresh.length === 0) return 0;

    const batchId = createInviteBatch(this.sql, room.id, invitedBy, now);
    for (const target of fresh) {
      addInvitation(this.sql, { batchId, roomId: room.id, userId: target.userId, username: target.username, label: target.label, now });
    }
    const view = this.renderInviteBatch(room, batchId);
    const messageId = await this.send(view.text, { keyboard: view.keyboard, threadId: room.threadId });
    setInviteBatchMessage(this.sql, batchId, messageId);
    await this.refreshRoomMessage(room);
    return fresh.length;
  }

  private renderInviteBatch(room: Room, batchId: number): { text: string; keyboard: Keyboard } {
    const m = this.m();
    const batch = inviteBatch(this.sql, batchId)!;
    const invitations = batchInvitations(this.sql, batchId);
    // Mentions ping invitees in the original message; @usernames are linkified by Telegram itself.
    const ping = (invite: Invitation) =>
      invite.userId !== null ? mentionHtml(invite.userId, invite.label) : esc(invite.label);
    const plain = (invite: Invitation) => (invite.userId !== null ? this.nameHtml(invite.userId) : esc(invite.label));
    const title = esc(this.game(room.game).title(this.lang()));
    const lines = [m.inviteMessage(this.mentionOf(batch.invitedBy), invitations.map(ping).join(m.sep), title, room.id)];
    if (invitations.some((invite) => invite.status !== "pending")) {
      lines.push("", ...invitations.map((invite) => `${plain(invite)} ${m.inviteStatus[invite.status]}`));
    }
    const open = room.status !== "ended" && invitations.some((invite) => invite.status === "pending");
    const keyboard = open
      ? [[button(m.btnAccept, roomCallback(room.id, "ia", batchId), "success"), button(m.btnDecline, roomCallback(room.id, "id", batchId))]]
      : [];
    return { text: lines.join("\n"), keyboard };
  }

  private async redrawInviteBatch(room: Room, batchId: number): Promise<void> {
    const batch = inviteBatch(this.sql, batchId);
    if (!batch?.messageId) return;
    const view = this.renderInviteBatch(room, batchId);
    await this.deps.tg.editMessage(this.deps.chatId, batch.messageId, view.text, view.keyboard);
  }

  private async answerInvite(
    room: Room,
    batchId: number,
    accept: boolean,
    from: TgUser,
    reply: CallbackReply,
    toast?: string,
  ): Promise<void> {
    const m = this.m();
    const game = this.game(room.game);
    const invitation = invitationFor(this.sql, batchId, from);
    if (!invitation || invitation.roomId !== room.id) {
      await reply.answer(m.notForYouInvite, true);
      return;
    }
    if (invitation.status !== "pending") {
      await reply.answer(m.alreadyAnswered);
      return;
    }
    const alreadyIn = isJoined(this.sql, room.id, from.id);
    if (accept && !alreadyIn && joinedPlayers(this.sql, room.id).length >= game.maxPlayers) {
      await reply.answer(m.roomFull(game.maxPlayers));
      return;
    }
    respondToInvitation(this.sql, invitation.id, accept ? "accepted" : "declined", from.id, this.now());
    await reply.answer(toast);
    if (accept && !alreadyIn) await this.addToRoom(room, from.id);
    await this.redrawInviteBatch(room, batchId);
    await this.refreshRoomMessage(room);
  }

  private async requestJoin(room: Room, from: TgUser, reply: CallbackReply): Promise<void> {
    const m = this.m();
    const game = this.game(room.game);
    if (isJoined(this.sql, room.id, from.id)) {
      await reply.answer(m.alreadyIn);
      return;
    }
    const invitation = hasPendingInvitation(this.sql, room.id, { id: from.id, username: from.username });
    if (invitation) {
      // Already invited: asking to join counts as accepting.
      await this.answerInvite(room, invitation.batchId, true, from, reply, m.joinedViaInvite);
      return;
    }
    if (pendingRequestFor(this.sql, room.id, from.id)) {
      await reply.answer(m.requestAlreadyPending);
      return;
    }
    if (joinedPlayers(this.sql, room.id).length >= game.maxPlayers) {
      await reply.answer(m.roomFull(game.maxPlayers));
      return;
    }
    const requestId = createJoinRequest(this.sql, room.id, from.id, this.now());
    await reply.answer(m.requestSent);
    const keyboard = [
      [
        button(m.btnApprove, roomCallback(room.id, "ra", requestId), "success"),
        button(m.btnDeny, roomCallback(room.id, "rd", requestId), "danger"),
      ],
    ];
    const messageId = await this.send(m.joinRequestMessage(this.mentionOf(from.id), room.id, this.mentionOf(room.hostId)), {
      keyboard,
      threadId: room.threadId,
    });
    setRequestMessage(this.sql, requestId, messageId);
    await this.refreshRoomMessage(room);
  }

  private async decideRequest(room: Room, requestId: number, approve: boolean, reply: CallbackReply): Promise<void> {
    const m = this.m();
    const game = this.game(room.game);
    const request = getJoinRequest(this.sql, requestId);
    if (!request || request.roomId !== room.id || request.status !== "pending") {
      await reply.answer(m.requestAlreadyDecided);
      return;
    }
    const who = this.nameHtml(request.userId);
    const alreadyIn = isJoined(this.sql, room.id, request.userId);
    if (approve && !alreadyIn && joinedPlayers(this.sql, room.id).length >= game.maxPlayers) {
      await reply.answer(m.roomFull(game.maxPlayers));
      return;
    }
    decideJoinRequest(this.sql, request.id, approve ? "approved" : "denied", room.hostId, this.now());
    await reply.answer();
    if (approve && !alreadyIn) await this.addToRoom(room, request.userId);
    if (request.messageId !== null) {
      await this.deps.tg.editMessage(
        this.deps.chatId,
        request.messageId,
        approve ? m.joinRequestApproved(who, room.id) : m.joinRequestDenied(who),
      );
    }
    await this.refreshRoomMessage(room);
  }

  private async addToRoom(room: Room, userId: number): Promise<void> {
    const m = this.m();
    const now = this.now();
    addPlayer(this.sql, room.id, userId, now);
    // Whichever way they got in, their other pending invitation or request is settled too.
    const request = pendingRequestFor(this.sql, room.id, userId);
    if (request) {
      decideJoinRequest(this.sql, request.id, "approved", null, now);
      if (request.messageId !== null) {
        await this.deps.tg.editMessage(this.deps.chatId, request.messageId, m.joinRequestApproved(this.nameHtml(userId), room.id));
      }
    }
    const member = getMember(this.sql, userId);
    const invitation = hasPendingInvitation(this.sql, room.id, { id: userId, username: member?.username });
    if (invitation) {
      respondToInvitation(this.sql, invitation.id, "accepted", userId, now);
      await this.redrawInviteBatch(room, invitation.batchId);
    }
    if (room.status === "playing") await this.game(room.game).onPlayerJoined(this.gameContext(room), userId);
  }

  private async leave(room: Room, from: TgUser, reply: CallbackReply): Promise<void> {
    const m = this.m();
    if (!isJoined(this.sql, room.id, from.id)) {
      await reply.answer(m.notIn);
      return;
    }
    if (joinedPlayers(this.sql, room.id).length <= 1) {
      await reply.answer(m.hostCannotLeaveAlone, true);
      return;
    }
    await reply.answer();
    await this.removeFromRoom(room, from.id, "left");
    await this.refreshRoomMessage(room);
  }

  private async removeFromRoom(room: Room, userId: number, status: "left" | "kicked"): Promise<void> {
    const m = this.m();
    setPlayerStatus(this.sql, room.id, userId, status, this.now());
    if (room.status === "playing") await this.game(room.game).onPlayerLeft(this.gameContext(room), userId);
    if (status === "kicked") await this.send(m.playerKicked(this.nameHtml(userId)), { threadId: room.threadId });
    if (userId === room.hostId) {
      const successor = joinedPlayers(this.sql, room.id)[0];
      if (successor !== undefined) {
        room.hostId = successor;
        await this.send(m.hostChanged(this.mentionOf(successor)), { threadId: room.threadId });
      }
    }
  }

  // --------------------------------------------------------------- pickers

  private pickerCandidates(room: Room, mode: PickerMode): number[] {
    const players = joinedPlayers(this.sql, room.id);
    if (mode === "kick") return players.filter((id) => id !== room.hostId);
    const inRoom = new Set(players);
    const pending = pendingInvitations(this.sql, room.id);
    return recentMembers(this.sql, 50)
      .filter(
        (member) =>
          !inRoom.has(member.userId) &&
          !pending.some(
            (invite) =>
              invite.userId === member.userId ||
              (!!invite.username && !!member.username && invite.username.toLowerCase() === member.username.toLowerCase()),
          ),
      )
      .slice(0, PICKER_LIMIT)
      .map((member) => member.userId);
  }

  private renderPicker(room: Room, mode: PickerMode, selected: number[]): { text: string; keyboard: Keyboard } {
    const m = this.m();
    const candidates = this.pickerCandidates(room, mode);
    const rows: Keyboard = [];
    for (let index = 0; index < candidates.length; index += 2) {
      rows.push(
        candidates
          .slice(index, index + 2)
          .map((id) => {
            const picked = selected.includes(id);
            const label = `${picked ? `${G.check} ` : ""}${nameOf(this.sql, id)}`;
            return button(label, roomCallback(room.id, "pk", id), picked ? "primary" : undefined);
          }),
      );
    }
    const submit = mode === "invite" ? m.btnSendInvites(selected.length) : m.btnKickSelected(selected.length);
    rows.push([
      button(submit, roomCallback(room.id, "ps"), mode === "invite" ? "success" : "danger"),
      button(m.btnClose, roomCallback(room.id, "pc")),
    ]);
    return { text: mode === "invite" ? m.pickerInviteTitle : m.pickerKickTitle, keyboard: rows };
  }

  private async openPicker(room: Room, mode: PickerMode, reply: CallbackReply): Promise<void> {
    const m = this.m();
    if (this.pickerCandidates(room, mode).length === 0) {
      await reply.answer(mode === "invite" ? m.pickerEmptyInvite : m.pickerEmptyKick, true);
      return;
    }
    await reply.answer();
    const view = this.renderPicker(room, mode, []);
    const messageId = await this.send(view.text, { keyboard: view.keyboard, threadId: room.threadId });
    createPicker(this.sql, messageId, room.id, mode, this.now());
  }

  private async togglePick(room: Room, messageId: number | null, userId: number, reply: CallbackReply): Promise<void> {
    const picker = messageId !== null ? getPicker(this.sql, messageId) : undefined;
    if (!picker || picker.roomId !== room.id) {
      await reply.answer(this.m().staleButton);
      return;
    }
    const selected = picker.selected.includes(userId)
      ? picker.selected.filter((id) => id !== userId)
      : [...picker.selected, userId];
    savePickerSelection(this.sql, picker.messageId, selected);
    await reply.answer();
    const view = this.renderPicker(room, picker.mode, selected);
    await this.deps.tg.editMessage(this.deps.chatId, picker.messageId, view.text, view.keyboard);
  }

  private async submitPicker(room: Room, messageId: number | null, reply: CallbackReply): Promise<void> {
    const m = this.m();
    const picker = messageId !== null ? getPicker(this.sql, messageId) : undefined;
    if (!picker || picker.roomId !== room.id) {
      await reply.answer(m.staleButton);
      return;
    }
    // People may have joined or left since the picker opened.
    const stillValid = new Set(this.pickerCandidates(room, picker.mode));
    const chosen = picker.selected.filter((id) => stillValid.has(id));
    if (chosen.length === 0) {
      await reply.answer(m.nothingSelected);
      return;
    }
    await reply.answer();
    deletePicker(this.sql, picker.messageId);
    if (picker.mode === "invite") {
      await this.deps.tg.editMessage(this.deps.chatId, picker.messageId, m.pickerInvitesSent(chosen.length));
      const targets = chosen.map((id) => ({
        userId: id,
        username: getMember(this.sql, id)?.username ?? null,
        label: nameOf(this.sql, id),
      }));
      await this.invite(room, targets, room.hostId);
      return;
    }
    await this.deps.tg.editMessage(
      this.deps.chatId,
      picker.messageId,
      `${m.pickerKickTitle}\n${chosen.map((id) => this.nameHtml(id)).join(m.sep)}`,
    );
    for (const id of chosen) await this.removeFromRoom(room, id, "kicked");
    await this.refreshRoomMessage(room);
  }

  private async closePicker(messageId: number | null, reply: CallbackReply): Promise<void> {
    const m = this.m();
    await reply.answer();
    const picker = messageId !== null ? getPicker(this.sql, messageId) : undefined;
    if (!picker) return;
    deletePicker(this.sql, picker.messageId);
    const title = picker.mode === "invite" ? m.pickerInviteTitle : m.pickerKickTitle;
    await this.deps.tg.editMessage(this.deps.chatId, picker.messageId, `${title}\n${m.pickerClosed}`);
  }

  // ------------------------------------------------- settings, start, end

  private async showView(room: Room, view: RoomView): Promise<void> {
    room.view = view;
    await this.refreshRoomMessage(room);
  }

  private async changeSetting(room: Room, args: string[], reply: CallbackReply): Promise<void> {
    const result = this.game(room.game).applySetting(room.settings, args, this.lang(), this.deps.llm !== null);
    if (result.alert) {
      await reply.answer(result.alert, true);
      return;
    }
    if (result.settings) room.settings = result.settings;
    await reply.answer();
    await this.refreshRoomMessage(room);
  }

  private async changeLanguage(room: Room, value: string | undefined): Promise<void> {
    const lang = parseLang(value);
    if (lang) setKv(this.sql, "lang", lang);
    await this.refreshRoomMessage(room);
  }

  private async startGame(room: Room, reply: CallbackReply): Promise<void> {
    const m = this.m();
    const game = this.game(room.game);
    if (room.status !== "lobby") {
      await reply.answer(m.staleButton);
      return;
    }
    if (joinedPlayers(this.sql, room.id).length < game.minPlayers) {
      await reply.answer(m.needMorePlayers(game.minPlayers), true);
      return;
    }
    await reply.answer();
    const now = this.now();
    room.status = "playing";
    room.startedAt = now;
    room.view = "main";
    cancelDeadlines(this.sql, room.id, "idle");
    scheduleDeadline(this.sql, room.id, "idle", now + PLAYING_IDLE_MS);
    if (room.messageId !== null) room.pinned = await this.deps.tg.pinMessage(this.deps.chatId, room.messageId);
    await game.start(this.gameContext(room));
  }

  private async skipTurn(room: Room, by: number, reply: CallbackReply): Promise<void> {
    if (room.status !== "playing") {
      await reply.answer(this.m().gameNotStarted);
      return;
    }
    const toast = await this.game(room.game).onSkip(this.gameContext(room), by);
    await reply.answer(toast ?? undefined);
  }

  private async endRoom(room: Room, reason: EndReason): Promise<void> {
    const now = this.now();
    let summary: string | null = null;
    if (room.status === "playing") summary = await this.game(room.game).finish(this.gameContext(room));
    room.status = "ended";
    room.endedAt = now;
    room.endReason = reason;
    room.view = "main";
    cancelDeadlines(this.sql, room.id);
    cancelPendingInvitations(this.sql, room.id, now);
    cancelPendingRequests(this.sql, room.id, now);
    saveRoom(this.sql, room);
    if (room.pinned && room.messageId !== null) {
      await this.deps.tg.unpinMessage(this.deps.chatId, room.messageId);
      room.pinned = false;
    }
    await this.refreshRoomMessage(room);
    if (summary) await this.send(summary, { threadId: room.threadId });
  }

  private async checkIdle(room: Room): Promise<void> {
    const limit = room.status === "lobby" ? LOBBY_IDLE_MS : PLAYING_IDLE_MS;
    if (this.now() - room.lastActivityAt >= limit) await this.endRoom(room, "idle");
    else scheduleDeadline(this.sql, room.id, "idle", room.lastActivityAt + limit);
  }

  private async onMigrated(toChatId: number): Promise<void> {
    const room = activeRoom(this.sql);
    if (room) {
      // The old chat is read-only after an upgrade, so close the room without touching its messages.
      room.status = "ended";
      room.endedAt = this.now();
      room.endReason = "migrated";
      cancelDeadlines(this.sql, room.id);
      saveRoom(this.sql, room);
    }
    if (this.deps.migrateTo) await this.deps.migrateTo(toChatId, exportSnapshot(this.sql));
  }

  // ------------------------------------------------------------ room views

  private async refreshRoomMessage(room: Room): Promise<void> {
    const view = this.renderRoom(room);
    if (room.messageId !== null) {
      const edited = await this.deps.tg.editMessage(this.deps.chatId, room.messageId, view.text, view.keyboard);
      if (edited) return;
    }
    if (room.status === "ended") return;
    // Someone deleted the room message; put a fresh one at the bottom of the chat.
    room.messageId = await this.send(view.text, { keyboard: view.keyboard, threadId: room.threadId });
    if (room.pinned) room.pinned = await this.deps.tg.pinMessage(this.deps.chatId, room.messageId);
  }

  private renderRoom(room: Room): { text: string; keyboard: Keyboard } {
    const m = this.m();
    const lang = this.lang();
    const game = this.game(room.game);
    const status = { lobby: m.statusLobby, playing: m.statusPlaying, ended: m.statusEnded }[room.status];
    const lines = [m.roomHeader(esc(game.title(lang)), room.id, status)];
    if (room.status === "ended" && room.startedAt === null) {
      lines.push(m.roomDisbanded);
      return { text: lines.join("\n"), keyboard: [] };
    }
    lines.push(m.hostLine(this.nameHtml(room.hostId)), ...game.describeSettings(room.settings, lang));
    if (room.status === "lobby") {
      const players = joinedPlayers(this.sql, room.id);
      lines.push("", m.playersLine(players.length, players.map((id) => this.nameHtml(id)).join(m.sep)));
    }
    if (room.status !== "ended") {
      const invited = pendingInvitations(this.sql, room.id);
      if (invited.length) lines.push(m.invitedLine(invited.map((invite) => esc(invite.label)).join(m.sep)));
      const requested = pendingRequests(this.sql, room.id);
      if (requested.length) lines.push(m.requestedLine(requested.map((request) => this.nameHtml(request.userId)).join(m.sep)));
    }
    if (room.status === "lobby") lines.push("", m.lobbyHint(game.minPlayers));
    else lines.push("", game.renderBoard(this.gameContext(room)));
    if (room.status === "ended" && room.endReason) lines.push("", m.endedLine(m.endReason[room.endReason]));
    if (room.view === "settings") lines.push("", m.settingsPrompt);
    if (room.view === "confirm-end") lines.push("", room.status === "lobby" ? m.confirmDisbandPrompt : m.confirmEndPrompt);
    return { text: lines.join("\n"), keyboard: this.roomKeyboard(room) };
  }

  /** Colour language: green = go/confirm, red = destructive, blue = the main action or the selected option. */
  private roomKeyboard(room: Room): Keyboard {
    const m = this.m();
    const cb = (action: string, ...args: Array<string | number>) => roomCallback(room.id, action, ...args);
    if (room.status === "ended") return [];
    const joinRow = [button(m.btnRequestJoin, cb("j"), "primary"), button(m.btnLeave, cb("lv"))];
    if (room.view === "settings") {
      const lang = this.lang();
      const langOption = (label: string, value: Lang) =>
        button(lang === value ? `${G.check} ${label}` : label, cb("lang", value), lang === value ? "primary" : undefined);
      return [
        ...this.game(room.game).settingsKeyboard(room, lang, this.deps.llm !== null),
        [langOption("中文", "zh"), langOption("English", "en")],
        // Others can still get in while the host fiddles with settings (or forgets to close them).
        joinRow,
        [button(m.btnBack, cb("back"), "success")],
      ];
    }
    if (room.view === "confirm-end") {
      const confirm = room.status === "lobby" ? m.btnConfirmDisband : m.btnConfirmEnd;
      return [[button(confirm, cb("endy"), "danger"), button(m.btnCancel, cb("endn"))]];
    }
    const link = this.webLink(room);
    const openRow = link ? [[urlButton(m.btnOpenGame, link)]] : [];
    if (room.status === "lobby") {
      return [
        ...openRow,
        joinRow,
        [button(m.btnInvite, cb("inv")), button(m.btnSettings, cb("set"))],
        [button(m.btnStart, cb("go"), "success"), button(m.btnDisband, cb("end"), "danger")],
      ];
    }
    return [
      ...openRow,
      joinRow,
      [button(m.btnInvite, cb("inv")), button(m.btnKick, cb("kk")), button(m.btnSettings, cb("set"))],
      [button(m.btnSkip, cb("skip")), button(m.btnEnd, cb("end"), "danger")],
    ];
  }

  // ---------------------------------------------------------- game context

  private gameContext(room: Room): GameContext<any, any> {
    const chatId = this.deps.chatId;
    return {
      room,
      lang: this.lang(),
      core: this.m(),
      sql: this.sql,
      llm: this.deps.llm,
      now: () => this.now(),
      random: () => this.deps.random(),
      players: () => joinedPlayers(this.sql, room.id),
      everyPlayer: () => everyPlayer(this.sql, room.id),
      name: (userId) => this.nameHtml(userId),
      plainName: (userId) => nameOf(this.sql, userId),
      mention: (userId) => this.mentionOf(userId),
      send: (html, keyboard) => this.send(html, { keyboard, threadId: room.threadId }),
      edit: async (messageId, html, keyboard) => {
        await this.deps.tg.editMessage(chatId, messageId, html, keyboard);
      },
      dm: async (userId, html, keyboard) => {
        const sent = await this.deps.tg.sendDirect(userId, html, keyboard);
        markDmReachable(this.sql, userId, sent !== null);
        return sent !== null;
      },
      startLink: async () => `https://t.me/${await this.botUsername()}?start=g${chatId}`,
      dmCallback: (...args) => groupScopedCallback(chatId, roomCallback(room.id, "g", ...args)),
      log: (kind, actorId, data) =>
        appendLog(this.sql, { roomId: room.id, game: room.game, actorId, kind, data, now: this.now() }),
      schedule: (kind, dueAt, data) => scheduleDeadline(this.sql, room.id, kind, dueAt, data),
      cancelSchedule: (kind) => cancelDeadlines(this.sql, room.id, kind),
      refreshRoomMessage: () => this.refreshRoomMessage(room),
      callback: (...args) => roomCallback(room.id, "g", ...args),
      end: () => this.endRoom(room, "finished"),
    };
  }

  // -------------------------------------------------------------- mini app

  /** t.me link that opens this room's game page inside Telegram (games played in the Mini App only). */
  private webLink(room: Room): string | null {
    const appName = this.deps.config.webAppName;
    const bot = getKv(this.sql, "bot_username");
    if (!appName || !bot || !this.findGame(room.game)?.web) return null;
    return `https://t.me/${bot}/${appName}?startapp=${webStartParam(this.deps.chatId, room.id)}`;
  }

  /** The chat's record of a person, shaped like a Telegram user, for core flows that take one. */
  private userOf(userId: number): TgUser {
    const member = getMember(this.sql, userId);
    if (!member) return { id: userId, isBot: false, firstName: `#${userId}` };
    return {
      id: userId,
      isBot: false,
      firstName: member.firstName,
      lastName: member.lastName ?? undefined,
      username: member.username ?? undefined,
    };
  }

  /**
   * Someone opened the game page from this group's link; the Worker has
   * already verified their Telegram login. Only current group members get in.
   */
  async webJoin(user: TgUser, roomId: number): Promise<WebJoinResult> {
    const room = loadRoom(this.sql, roomId);
    if (!room || !this.findGame(room.game)?.web) return { ok: false, reason: "room" };
    const status = await this.deps.tg.getChatMemberStatus(this.deps.chatId, user.id);
    if (status === null || status === "left" || status === "kicked") return { ok: false, reason: "member" };
    rememberUser(this.sql, user, this.now());
    return { ok: true };
  }

  /** What one person's game page shows right now; null once the room no longer exists. */
  webView(userId: number, roomId: number): WebView | null {
    const room = loadRoom(this.sql, roomId);
    const game = room ? this.findGame(room.game) : undefined;
    if (!room || !game?.web) return null;
    const m = this.m();
    const lang = this.lang();
    const person = (id: number) => ({ id, name: nameOf(this.sql, id) });
    const players = joinedPlayers(this.sql, room.id);
    const isHost = userId === room.hostId;
    const open = room.status !== "ended";
    const newer = open ? undefined : activeRoom(this.sql);
    return {
      lang,
      me: {
        id: userId,
        name: nameOf(this.sql, userId),
        isHost,
        isPlayer: players.includes(userId),
        requested: open && !!pendingRequestFor(this.sql, room.id, userId),
      },
      room: {
        id: room.id,
        title: game.title(lang),
        status: room.status,
        host: person(room.hostId),
        players: players.map(person),
        settings: game.describeSettings(room.settings, lang).map(htmlToText),
        options: room.status === "lobby" ? (game.web.settings?.(room.settings, lang) ?? []) : [],
        minPlayers: game.minPlayers,
        maxPlayers: game.maxPlayers,
        endReason: room.endReason ? m.endReason[room.endReason] : null,
        requests:
          isHost && open
            ? pendingRequests(this.sql, room.id).map((request) => ({ id: request.id, user: person(request.userId) }))
            : [],
        next: newer && this.findGame(newer.game)?.web ? newer.id : null,
      },
      game: room.startedAt === null ? null : (game.web.view(this.gameContext(room), userId) ?? null),
    };
  }

  /** A tap in the game page. Resolves to a short notice for that person, or null. */
  async webAction(userId: number, roomId: number, request: WebRequest): Promise<string | null> {
    const m = this.m();
    const room = loadRoom(this.sql, roomId);
    if (!room || room.status === "ended") return m.roomGone;
    const notices: string[] = [];
    const reply: CallbackReply = {
      answer: async (text?: string) => {
        if (text) notices.push(text);
      },
    };
    try {
      room.lastActivityAt = this.now();
      switch (request.a) {
        case "join":
          await this.requestJoin(room, this.userOf(userId), reply);
          break;
        case "start":
          if (userId !== room.hostId) return m.hostOnly;
          await this.startGame(room, reply);
          break;
        case "set":
          if (userId !== room.hostId) return m.hostOnly;
          if (room.status !== "lobby") return m.staleButton;
          await this.changeSetting(room, [request.key, request.value], reply);
          break;
        case "approve":
        case "deny":
          if (userId !== room.hostId) return m.hostOnly;
          await this.decideRequest(room, Number(request.request), request.a === "approve", reply);
          break;
        case "g": {
          const web = this.game(room.game).web;
          if (!web) return m.staleButton;
          if (room.status !== "playing") return m.gameNotStarted;
          const { a: _envelope, ...action } = request;
          const notice = await web.onAction(this.gameContext(room), userId, action as WebAction);
          if (notice) notices.push(notice);
          break;
        }
        default:
          return m.staleButton;
      }
    } catch (error) {
      console.error("game page action failed", request, error);
      notices.unshift(m.somethingWrong);
    } finally {
      saveRoom(this.sql, room);
      await this.syncAlarm();
    }
    return notices[0] ?? null;
  }
}

/** Settings lines are Telegram HTML; the game page shows them as plain text. */
function htmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
