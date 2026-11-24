import type { Llm } from "../ai/llm";
import type { Sql } from "../platform/sql";
import type { TgUser } from "../telegram/intents";
import type { Keyboard } from "../telegram/port";
import type { WebSetting } from "../web/protocol";
import type { CoreMessages, Lang } from "./i18n";
import type { Room } from "./rooms";

/** Lets a game answer the button press that triggered it (exactly once). */
export interface CallbackReply {
  answer(text?: string, alert?: boolean): Promise<void>;
}

/**
 * Everything a game can do. The core owns rooms, players, invitations, the
 * room message and persistence; a game only owns its `room.state` and the
 * messages it sends. The core saves `room` after every handler returns.
 */
export interface GameContext<Settings, State> {
  readonly room: Room<Settings, State>;
  readonly lang: Lang;
  readonly core: CoreMessages;
  readonly sql: Sql;
  readonly llm: Llm | null;
  now(): number;
  random(): number;
  /** Current players, earliest joiner first. */
  players(): number[];
  /** Everyone who was ever in the room. */
  everyPlayer(): number[];
  /** Display name, already HTML-escaped for message text. */
  name(userId: number): string;
  /** Unescaped display name, for button toasts (which are plain text). */
  plainName(userId: number): string;
  /** Name that pings the user when it appears in a newly sent message. */
  mention(userId: number): string;
  send(html: string, keyboard?: Keyboard): Promise<number>;
  edit(messageId: number, html: string, keyboard?: Keyboard): Promise<void>;
  /**
   * Private message to a player (hidden roles, secret words). Resolves to false
   * if the player has not opened a chat with the bot yet; send them `startLink()`.
   */
  dm(userId: number, html: string, keyboard?: Keyboard): Promise<boolean>;
  /** Deep link that opens a private chat with the bot and reports back to this group. */
  startLink(): Promise<string>;
  /** Callback data for a button sent in DM; presses are routed back to this group's room. */
  dmCallback(...args: Array<string | number>): string;
  /** Appends to the turn log and returns the entry's sequence number within the room. */
  log(kind: string, actorId: number | null, data: unknown): number;
  schedule(kind: string, dueAt: number, data?: Record<string, unknown>): void;
  cancelSchedule(kind?: string): void;
  /** Re-renders the room message (the live board while playing). */
  refreshRoomMessage(): Promise<void>;
  /** Builds callback data for a game button: `r<room>:g:<args>`. */
  callback(...args: Array<string | number>): string;
  /**
   * Ends the game because it ran its course: `finish` runs, the summary is
   * posted and the room closes. Leave `room.state` alone after awaiting this.
   */
  end(): Promise<void>;
}

/** An action sent from the Mini App: `{ a: "g", op: "...", ...game fields }`. */
export type WebAction = { op: string } & Record<string, unknown>;

/**
 * The Mini App side of a game that is played in the game page rather than
 * through chat buttons. The core handles the page's login, connection and
 * lobby; the game supplies what each person sees and what their taps do.
 */
export interface WebGame<Settings, State> {
  /**
   * The game part of one person's page, recomputed after every change and sent
   * to everyone connected. Must be pure, and must never include anything that
   * person may not see yet (a word they have to guess, other people's clues).
   */
  view(game: GameContext<Settings, State>, userId: number): unknown;
  /** Something a person did in the page. Resolves to a short notice for them, or null. */
  onAction(game: GameContext<Settings, State>, userId: number, action: WebAction): Promise<string | null>;
  /**
   * The settings as rows of choices for the lobby page. Picking one runs
   * `applySetting(settings, [key, value])`, same as the room message's buttons.
   */
  settings?(settings: Settings, lang: Lang): WebSetting[];
}

export interface SettingsResult<Settings> {
  settings?: Settings;
  alert?: string;
}

export interface GameModule<Settings = any, State = any> {
  readonly id: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  title(lang: Lang): string;
  /** The "how to play" part of /help. */
  helpText(lang: Lang): string;
  defaultSettings(aiAvailable: boolean): Settings;
  /** Lines for the room message describing the current settings. */
  describeSettings(settings: Settings, lang: Lang): string[];
  /** Host-only settings keyboard; buttons must use `r<room>:st:<args>` payloads. */
  settingsKeyboard(room: Room<Settings, State>, lang: Lang, aiAvailable: boolean): Keyboard;
  applySetting(settings: Settings, args: string[], lang: Lang, aiAvailable: boolean): SettingsResult<Settings>;

  start(game: GameContext<Settings, State>): Promise<void>;
  onAction(game: GameContext<Settings, State>, args: string[], from: TgUser, reply: CallbackReply): Promise<void>;
  onDeadline(game: GameContext<Settings, State>, kind: string, data: Record<string, unknown>): Promise<void>;
  onPlayerJoined(game: GameContext<Settings, State>, userId: number): Promise<void>;
  onPlayerLeft(game: GameContext<Settings, State>, userId: number): Promise<void>;
  /** Host pressed "skip turn". Returns a toast when there is nothing to skip. */
  onSkip(game: GameContext<Settings, State>, by: number): Promise<string | null>;
  /** Live board shown in the room message while playing and after the end. */
  renderBoard(game: GameContext<Settings, State>): string;
  /** Wraps up an in-progress turn and returns the end-of-game summary (null if nothing was played). */
  finish(game: GameContext<Settings, State>): Promise<string | null>;
  /** Full turn log for /log. */
  renderLog(game: GameContext<Settings, State>): string;
  /** All-time stats for /stats; `focusUserId` narrows it to one person. */
  renderStats(sql: Sql, lang: Lang, names: (userId: number) => string, focusUserId: number | null): string | null;
  /** Present for games played in the Mini App; the room message then gets an "open game" button. */
  readonly web?: WebGame<Settings, State>;
}
