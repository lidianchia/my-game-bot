import type { GameContext } from "../../core/game";

/**
 * 猜大小 / High or Low: the template for new games. It is small on purpose
 * but has what most games need: settings, turns that rotate, something only
 * one person may see, timers, points, the turn log, a summary and stats. It is
 * not registered in src/games/index.ts, so nobody plays it; its test runs it.
 *
 * A new game starts as a copy of this folder plus public/app/games/_template.js
 * (the page) and test/unit/_template.test.ts; see "加一个新游戏" in the README.
 *
 * The rules: each turn one player leads and secretly picks a number from 1 to
 * 6, and may bluff about it in voice chat. Everyone else guesses high (4-6) or
 * low (1-3). A right guess scores for the guesser, a wrong one for the lead.
 * Everyone leads the same number of times, then the game ends itself.
 */

/** The game's id: its command, its page file's name (public/app/games/<id>.js) and its rows in the turn log. */
export const GAME_ID = "_template";

export type Side = "high" | "low";

export interface HiLoSettings {
  /** How many times each player leads. */
  rounds: number;
  /** How long the others have to guess, in seconds. */
  seconds: number;
}

/** Why a turn ended early: the host skipped it, the lead left, the lead never picked, or the game ended. */
export type SkipReason = "host" | "left" | "idle" | "ended";

/** picking -> guessing -> done; then the next turn, after a while or when someone taps "next". */
export interface HiLoTurn {
  no: number;
  leadId: number;
  phase: "picking" | "guessing" | "done";
  /** When the current phase times out. */
  endsAt: number | null;
  /** The lead's number: the one secret here. Only the lead's view carries it until the turn is done. */
  number: number | null;
  /** Who guesses: everyone else in the room when the turn started, minus anyone who left. */
  guessers: number[];
  /** Each guesser's call, by user id; a guesser may change it until everyone has called. */
  guesses: Record<string, Side>;
  /** Points this turn, by user id. */
  points: Record<string, number>;
  skipReason: SkipReason | null;
  startedAt: number;
  endedAt: number | null;
}

/** `room.state`: everything the game remembers. The core saves it after every handler. */
export interface HiLoState {
  /** Lead order: the players at the start in join order, latecomers appended. */
  order: number[];
  /** Turns led, by user id. */
  leads: Record<string, number>;
  turnNo: number;
  scores: Record<string, number>;
  turn: HiLoTurn | null;
}

export type HiLoContext = GameContext<HiLoSettings, HiLoState>;

/** One finished turn in the turn log (kind TURN_LOG_KIND): /log, the summary and /stats are built from these. */
export interface TurnRecord {
  v: 1;
  no: number;
  leadId: number;
  number: number | null;
  guesses: Record<string, Side>;
  points: Record<string, number>;
  skipReason: SkipReason | null;
  startedAt: number;
  endedAt: number;
}

export const TURN_LOG_KIND = "turn";

export const POINTS = {
  /** A guesser who called it right. */
  right: 1,
  /** The lead, for each guesser who called it wrong. */
  fooled: 1,
} as const;

export const TIMING = {
  /** The lead has this long to pick a number before the turn is skipped. */
  pickMs: 60_000,
  /** How long a turn's result stays up before the next turn starts by itself. */
  revealMs: 30_000,
} as const;

export const ROUNDS_CHOICES = [1, 2, 3];
export const SECONDS_CHOICES = [20, 30, 60];

export function sideOf(number: number): Side {
  return number >= 4 ? "high" : "low";
}
