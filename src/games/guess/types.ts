/**
 * 心照不宣 / Unsaid: a word game played in the Mini App, in two modes.
 *
 * Off-limits ("taboo"): one person describes words against the clock without
 *   saying the word or any of its four off-limits words; everyone else types
 *   guesses. A guessed word scores for the guesser and the describer; a foul
 *   (someone calls out an off-limits word, or the describer types one) costs
 *   the describer.
 *
 * Unique Clues ("unique"): one person guesses a word everyone else can see.
 *   Each of the others writes a one-word clue; identical clues cancel out, and
 *   the writers strike any that mean the same thing. The guesser sees only the
 *   clues left standing and gets one try.
 *
 * Turns rotate so everyone takes the lead (describer or guesser) the same
 * number of times; the game ends itself when everyone has had their turns.
 */

export type Mode = "taboo" | "unique";
/** "mix" alternates the two modes turn by turn. */
export type ModeSetting = Mode | "mix";

export interface GuessSettings {
  mode: ModeSetting;
  /** How many times each player takes the lead. */
  rounds: number;
  /** Length of an Off-limits describing turn, in seconds. */
  seconds: number;
}

/** A card as drawn for one room: the side in the room's language, frozen when drawn. */
export interface DrawnCard {
  id: string;
  word: string;
  taboo: string[];
  alt: string[];
}

/** Why a turn ended early: the host skipped it, the lead left, the describer never started, or the game ended. */
export type SkipReason = "host" | "left" | "idle" | "ended";

// ------------------------------------------------------------- Off-limits

export type FeedKind = "guess" | "hint" | "correct" | "skip" | "buzz" | "slip";

/** One line of an Off-limits turn's running feed, shown to everyone. */
export interface FeedItem {
  kind: FeedKind;
  userId: number;
  /** The guess or hint as typed; empty for skip and buzz. */
  text: string;
  /** The card's word, for items that close a card (it's no secret any more). */
  word?: string;
}

/** guessed = someone got it; skipped = describer passed; buzzed = someone called a foul; slipped = describer typed an off-limits word. */
export type TabooOutcome = "guessed" | "skipped" | "buzzed" | "slipped" | "timeout";

export interface TabooCardResult {
  card: DrawnCard;
  outcome: TabooOutcome;
  /** Who guessed it (guessed) or called the foul (buzzed). */
  by: number | null;
}

/** ready -> describing -> done */
export interface TabooTurn {
  mode: "taboo";
  no: number;
  /** The describer. */
  leadId: number;
  phase: "ready" | "describing" | "done";
  /** When the current phase times out. */
  endsAt: number | null;
  card: DrawnCard | null;
  results: TabooCardResult[];
  feed: FeedItem[];
  /** Points this turn, by user id. */
  points: Record<string, number>;
  skipReason: SkipReason | null;
  logged: boolean;
  startedAt: number;
  endedAt: number | null;
}

// ----------------------------------------------------------- Unique Clues

export type ClueRemoval = "duplicate" | "answer" | "struck";
export type UniqueOutcome = "correct" | "wrong" | "passed" | "timeout";

/** writing -> reviewing -> guessing -> done */
export interface UniqueTurn {
  mode: "unique";
  no: number;
  /** The guesser. */
  leadId: number;
  phase: "writing" | "reviewing" | "guessing" | "done";
  endsAt: number | null;
  card: DrawnCard;
  /** Who writes clues this turn: everyone else in the room when it started (minus anyone who left). */
  writers: number[];
  /** Clue by writer id. */
  clues: Record<string, string>;
  /** Clues removed automatically when the review began: same as another clue, or giving the answer away. */
  auto: Record<string, "duplicate" | "answer">;
  /** Writer id -> the writers who struck that clue during the review. */
  strikes: Record<string, number[]>;
  /** Writers who said the review is done. */
  confirmed: number[];
  guess: string | null;
  outcome: UniqueOutcome | null;
  /** The host ruled a guess that didn't match the card as correct. */
  accepted: boolean;
  points: Record<string, number>;
  skipReason: SkipReason | null;
  logged: boolean;
  startedAt: number;
  endedAt: number | null;
}

export type GuessTurn = TabooTurn | UniqueTurn;

export interface GuessState {
  /** Lead order: the players at the start in join order, latecomers appended. */
  order: number[];
  /** Lead turns taken, by user id. */
  leads: Record<string, number>;
  turnNo: number;
  scores: Record<string, number>;
  usedCards: string[];
  turn: GuessTurn | null;
}

// ------------------------------------------------------------- turn log

/**
 * Turn log entry (kind "turn"). Written when the next turn starts or the game
 * ends rather than the moment a turn finishes, so a host ruling in between
 * still makes it into the record.
 */
export type TurnRecord =
  | {
      v: 1;
      mode: "taboo";
      no: number;
      leadId: number;
      results: TabooCardResult[];
      points: Record<string, number>;
      skipReason: SkipReason | null;
      startedAt: number;
      endedAt: number;
    }
  | {
      v: 1;
      mode: "unique";
      no: number;
      leadId: number;
      card: DrawnCard;
      clues: Record<string, string>;
      /** Why each removed clue was removed; clues not listed survived. */
      removed: Record<string, ClueRemoval>;
      guess: string | null;
      outcome: UniqueOutcome | null;
      accepted: boolean;
      points: Record<string, number>;
      skipReason: SkipReason | null;
      startedAt: number;
      endedAt: number;
    };

export const TURN_LOG_KIND = "turn";

export const POINTS = {
  /** Off-limits: a guessed word, to whoever guessed it... */
  guessed: 1,
  /** ...and to the describer. */
  described: 1,
  /** Off-limits: the describer said or typed an off-limits word. */
  foul: -1,
  /** Unique Clues: the guesser, when right. */
  solved: 2,
  /** Unique Clues: each writer whose clue survived, when the guess is right. */
  clue: 1,
} as const;

export const TIMING = {
  /** The describer has this long to press Start before the turn is skipped. */
  readyMs: 90_000,
  writeMs: 75_000,
  reviewMs: 30_000,
  guessMs: 60_000,
  /** After the last turn, the game closes itself this long after nobody moves on. */
  wrapUpMs: 60_000,
} as const;

export const LIMITS = {
  guessChars: 40,
  hintChars: 80,
  clueChars: 20,
  /** Off-limits feed lines kept per turn. */
  feed: 40,
} as const;

export const MODE_SETTINGS: ModeSetting[] = ["mix", "taboo", "unique"];
export const ROUNDS_CHOICES = [1, 2, 3];
export const SECONDS_CHOICES = [60, 90, 120];
