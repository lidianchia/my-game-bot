import type { DareType, Level } from "./content/types";

export type { DareType, Level };
export type TodKind = "truth" | "dare";
export type QuestionKind = TodKind | "penalty";
export type Source = "deck" | "ai" | "mix";

export interface TodSettings {
  level: Level;
  source: Source;
  /** Free "new question" presses per player per game. */
  rerolls: number;
  dareTypes: DareType[];
  voteSeconds: number;
}

export interface Question {
  text: string;
  from: "deck" | "ai";
  cardId?: string;
  provider?: string;
  level: Level;
  type?: DareType;
}

/**
 * choosing -> performing -> voting -> done
 *                 |            '-> (vote failed) -> penalty -> penalty-voting -> done
 *                 '-> (chicken) -----------------> penalty -> penalty-voting -> done
 */
export type Phase = "choosing" | "performing" | "voting" | "penalty" | "penalty-voting" | "done";

export interface Ballot {
  yes: number[];
  no: number[];
}

export interface OpenVote extends Ballot {
  stage: "main" | "penalty";
  /** Players allowed to vote: everyone in the room when voting opened, except the performer. */
  eligible: number[];
  closesAt: number;
}

export type MainOutcome = "pass" | "fail" | "chicken" | "skipped";
export type PenaltyOutcome = "pass" | "fail" | "skipped";
export type SkipReason = "host" | "left";

export interface Turn {
  no: number;
  playerId: number;
  messageId: number | null;
  phase: Phase;
  kind: TodKind | null;
  question: Question | null;
  rerolled: Question[];
  outcome: MainOutcome | null;
  mainVote: Ballot | null;
  penalty: Question | null;
  penaltyOutcome: PenaltyOutcome | null;
  penaltyVote: Ballot | null;
  vote: OpenVote | null;
  points: number;
  skipReason: SkipReason | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TodState {
  turnNo: number;
  /** Keyed by user id (JSON object keys are strings). */
  scores: Record<string, number>;
  rerollsUsed: Record<string, number>;
  usedCards: string[];
  /** Recent question texts, handed to the AI so it doesn't repeat itself. */
  recentTexts: string[];
  turn: Turn | null;
}

/** Turn log entry (kind "turn"): one finished turn, everything needed for /log, summaries and /stats. */
export interface TurnRecord {
  v: 1;
  no: number;
  playerId: number;
  kind: TodKind | null;
  level: Level;
  question: Question | null;
  rerolled: Question[];
  outcome: MainOutcome;
  mainVote: Ballot | null;
  penalty: Question | null;
  penaltyOutcome: PenaltyOutcome | null;
  penaltyVote: Ballot | null;
  points: number;
  skipReason: SkipReason | null;
  startedAt: number;
  endedAt: number;
}

export const TURN_LOG_KIND = "turn";

export const POINTS = {
  truthPass: 1,
  darePass: 2,
  fail: -1,
  chicken: -2,
  penaltyPass: 1,
  penaltyFail: -1,
} as const;
