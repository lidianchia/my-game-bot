import type { HiLoState, HiLoTurn, TurnRecord } from "./types";

/**
 * Pure helpers, shared by the flow (index.ts), the page view (view.ts) and the
 * chat renderers (render.ts).
 */

/**
 * Who leads next: whoever has led the fewest times, earliest in the order.
 * Null once every current player has led `rounds` times.
 */
export function nextLead(state: HiLoState, players: readonly number[], rounds: number): number | null {
  const ordered = [...state.order.filter((id) => players.includes(id)), ...players.filter((id) => !state.order.includes(id))];
  let best: number | null = null;
  let fewest = Infinity;
  for (const id of ordered) {
    const led = state.leads[id] ?? 0;
    if (led < rounds && led < fewest) {
      best = id;
      fewest = led;
    }
  }
  return best;
}

/** The current turn number and the total the game is heading for with the people in it now. */
export function progress(state: HiLoState, players: readonly number[], rounds: number): { no: number; total: number } {
  const remaining = players.reduce((sum, id) => sum + Math.max(0, rounds - (state.leads[id] ?? 0)), 0);
  return { no: state.turnNo, total: state.turnNo + remaining };
}

export function toRecord(turn: HiLoTurn, endedAt: number): TurnRecord {
  return {
    v: 1,
    no: turn.no,
    leadId: turn.leadId,
    number: turn.number,
    guesses: turn.guesses,
    points: turn.points,
    skipReason: turn.skipReason,
    startedAt: turn.startedAt,
    endedAt,
  };
}
