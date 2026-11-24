import type { ClueRemoval, GuessState, GuessTurn, TurnRecord, UniqueTurn } from "./types";

/**
 * Whose turn it is to lead next: whoever has led the fewest times, earliest in
 * the order. Null once every current player has led `rounds` times.
 */
export function nextLead(state: GuessState, players: readonly number[], rounds: number): number | null {
  const ordered = [...state.order.filter((id) => players.includes(id)), ...players.filter((id) => !state.order.includes(id))];
  let best: number | null = null;
  let fewest = Infinity;
  for (const id of ordered) {
    const taken = state.leads[id] ?? 0;
    if (taken < rounds && taken < fewest) {
      best = id;
      fewest = taken;
    }
  }
  return best;
}

/** The current turn number and the total the game is heading for with the people in it now. */
export function progress(state: GuessState, players: readonly number[], rounds: number): { no: number; total: number } {
  const remaining = players.reduce((sum, id) => sum + Math.max(0, rounds - (state.leads[id] ?? 0)), 0);
  return { no: state.turnNo, total: state.turnNo + remaining };
}

/** Why a writer's clue is out, or null if it still stands. */
export function removalOf(turn: UniqueTurn, writer: string): ClueRemoval | null {
  return turn.auto[writer] ?? ((turn.strikes[writer]?.length ?? 0) > 0 ? "struck" : null);
}

/** Writers whose clues the guesser gets to see, in writing order. */
export function survivingWriters(turn: UniqueTurn): number[] {
  return turn.writers.concat(Object.keys(turn.clues).map(Number).filter((id) => !turn.writers.includes(id)))
    .filter((writer) => turn.clues[writer] !== undefined && removalOf(turn, String(writer)) === null);
}

/** Writers still in the turn who haven't written yet. */
export function missingClues(turn: UniqueTurn): number[] {
  return turn.writers.filter((writer) => turn.clues[writer] === undefined);
}

export function toRecord(turn: GuessTurn, endedAt: number): TurnRecord {
  const base = {
    v: 1 as const,
    no: turn.no,
    leadId: turn.leadId,
    points: turn.points,
    skipReason: turn.skipReason,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt ?? endedAt,
  };
  if (turn.mode === "taboo") return { ...base, mode: "taboo", results: turn.results };
  const removed: Record<string, ClueRemoval> = {};
  for (const writer of Object.keys(turn.clues)) {
    const why = removalOf(turn, writer);
    if (why) removed[writer] = why;
  }
  return {
    ...base,
    mode: "unique",
    card: turn.card,
    clues: turn.clues,
    removed,
    guess: turn.guess,
    outcome: turn.outcome,
    accepted: turn.accepted,
  };
}
