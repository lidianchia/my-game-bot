import type { Lang } from "../core/i18n";
import type { RoomStatus } from "../core/rooms";

/**
 * What travels over the Mini App WebSocket. The page (public/app/*.js) imports
 * these types through JSDoc, so both sides are checked against one definition.
 *
 * The server is the only source of truth: after anything changes it sends each
 * connected person a fresh view tailored to them (never containing what they
 * aren't allowed to see yet), and the page just draws it.
 */
export interface WebPerson {
  id: number;
  name: string;
}

/**
 * One setting as a row of choices, so the host can change it from the lobby.
 * Picking an option sends `{ a: "set", key, value }`. Unless the game draws its
 * own settings panel, the room message's panel shows the same rows as buttons,
 * each with just the option's label, so labels should make sense on their own.
 */
export interface WebSetting {
  key: string;
  label: string;
  options: Array<{ value: string; label: string; on: boolean }>;
}

export interface WebRoom {
  id: number;
  /** The game's id (`GameModule.id`); the page draws it with public/app/games/<id>.js. */
  game: string;
  title: string;
  status: RoomStatus;
  host: WebPerson;
  players: WebPerson[];
  /** Plain-text lines describing the settings, as on the room message. */
  settings: string[];
  /** The settings as rows of choices while in the lobby; empty when the game has none (then show `settings`). */
  options: WebSetting[];
  minPlayers: number;
  maxPlayers: number;
  /** Why the room ended, in the chat's language. */
  endReason: string | null;
  /** Join requests waiting for a decision; only filled in for the host. */
  requests: Array<{ id: number; user: WebPerson }>;
  /** A newer game room in the same group, to hop over to once this one is over. */
  next: number | null;
}

export interface WebView<GameView = unknown> {
  lang: Lang;
  me: {
    id: number;
    name: string;
    isHost: boolean;
    isPlayer: boolean;
    /** Asked to join and waiting for the host. */
    requested: boolean;
  };
  room: WebRoom;
  /** The game's own view once it has started (see the game's `web.view`). */
  game: GameView | null;
}

/** Page -> server. `g` carries a game action; its other fields belong to the game. */
export type ClientMessage =
  | { a: "hello" }
  | { a: "join" }
  | { a: "start" }
  | { a: "set"; key: string; value: string }
  | { a: "approve"; request: number }
  | { a: "deny"; request: number }
  | ({ a: "g"; op: string } & Record<string, unknown>);

/** Server -> page. `now` is the server clock, so countdowns survive a phone whose clock is off. */
export type ServerMessage =
  | { t: "view"; now: number; view: WebView }
  | { t: "toast"; text: string }
  | { t: "gone"; reason: "room" | "session" };

/** WebSocket close code telling the page its session token is no longer valid and it should log in again. */
export const CLOSE_SESSION_EXPIRED = 4001;
