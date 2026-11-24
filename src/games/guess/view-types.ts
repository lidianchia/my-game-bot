import type { WebPerson } from "../../web/protocol";
import type { ClueRemoval, FeedKind, GuessSettings, SkipReason, TabooOutcome, TabooTurn, UniqueOutcome, UniqueTurn } from "./types";

/**
 * What one person's game page shows. Built fresh for every connected person
 * after every change, and the only place that decides who sees what:
 *   - Off-limits: only the describer gets the word and its off-limits words.
 *   - Unique Clues: everyone but the guesser sees the word; nobody sees other
 *     people's clues while writing; the guesser never sees clues that were
 *     taken out, and sees the surviving ones only once it's time to guess.
 * Everything is revealed when the turn is over.
 */
export interface GuessView {
  settings: GuessSettings;
  scores: Array<WebPerson & { score: number }>;
  progress: { no: number; total: number };
  turn: TabooView | UniqueView | null;
  /** True when the turn on screen is over and nobody has a turn left: "next" ends the game. */
  last: boolean;
}

export interface Points {
  id: number;
  name: string;
  points: number;
}

export interface TabooView {
  mode: "taboo";
  no: number;
  lead: WebPerson;
  /** lead = describing; player = guessing; watcher = not in the game. */
  role: "lead" | "player" | "watcher";
  phase: TabooTurn["phase"];
  endsAt: number | null;
  /** The current phase's full length (ms), for the countdown bar; null when nothing is timed. */
  span: number | null;
  /**
   * The card in play. Everyone gets its position in the turn (taps say which
   * card they meant, so a late tap can't hit the next one); only the describer
   * gets the words. The deck id isn't sent: it would map to the word.
   */
  card: { ref: number; word: string | null; taboo: string[] } | null;
  results: Array<{ word: string; outcome: TabooOutcome; by: string | null }>;
  feed: Array<{ kind: FeedKind; whoId: number; who: string; text: string; word: string | null; mine: boolean }>;
  points: Points[];
  skipReason: SkipReason | null;
}

export interface UniqueView {
  mode: "unique";
  no: number;
  lead: WebPerson;
  /** lead = guessing; writer = writing a clue; watcher = everyone else. */
  role: "lead" | "writer" | "watcher";
  phase: UniqueTurn["phase"];
  endsAt: number | null;
  /** The current phase's full length (ms), for the countdown bar; null when nothing is timed. */
  span: number | null;
  /** Hidden from the guesser until the turn is over. */
  word: string | null;
  writers: Array<WebPerson & { wrote: boolean; confirmed: boolean }>;
  myClue: string | null;
  /** The clues this person may see right now, or null while they may see none. */
  clues: Array<{ writer: number; name: string; text: string; removed: ClueRemoval | null; struckByMe: boolean }> | null;
  guess: string | null;
  outcome: UniqueOutcome | null;
  accepted: boolean;
  points: Points[];
  skipReason: SkipReason | null;
}
