import type { WebPerson } from "../../web/protocol";
import type { HiLoSettings, HiLoTurn, Side, SkipReason } from "./types";

/**
 * What one person's game page shows of the game (`view.game` on the page).
 * The page (public/app/games/_template.js) imports these types through JSDoc,
 * so both sides are checked against one definition.
 */
export interface HiLoView {
  settings: HiLoSettings;
  scores: Array<WebPerson & { score: number }>;
  progress: { no: number; total: number };
  turn: HiLoTurnView | null;
  /** The turn on screen is over and nobody has a turn left: "next" ends the game. */
  last: boolean;
}

export interface HiLoTurnView {
  no: number;
  lead: WebPerson;
  /** lead = picks the number; guesser = guesses this turn; watcher = everyone else. */
  role: "lead" | "guesser" | "watcher";
  phase: HiLoTurn["phase"];
  endsAt: number | null;
  /** The current phase's full length (ms), for the countdown ring. */
  span: number | null;
  /** The lead's number: the lead sees it once picked, everyone once the turn is done. */
  number: number | null;
  /** Who guesses and whether they have; what they called only once the turn is done. */
  guessers: Array<WebPerson & { guessed: boolean; side: Side | null }>;
  /** This person's own call. */
  mine: Side | null;
  points: Array<WebPerson & { points: number }>;
  skipReason: SkipReason | null;
}
