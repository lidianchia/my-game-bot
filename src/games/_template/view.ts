import { nextLead, progress } from "./rules";
import { TIMING, type HiLoContext, type HiLoTurn } from "./types";
import type { HiLoTurnView, HiLoView } from "./view-types";

/**
 * Each person's view of the game, rebuilt for everyone connected after every
 * change. This is the one place that decides who sees what, so it must never
 * hand someone what they may not see yet: here, the lead's number.
 */
export function hiLoView(game: HiLoContext, userId: number): HiLoView | null {
  const state = game.room.state;
  if (!state) return null;
  const players = game.players();
  const rounds = game.room.settings.rounds;
  const scores = Object.entries(state.scores)
    .map(([id, score]) => ({ id: Number(id), name: game.plainName(Number(id)), score }))
    .filter((entry) => players.includes(entry.id) || entry.score !== 0)
    .sort((a, b) => b.score - a.score || state.order.indexOf(a.id) - state.order.indexOf(b.id));
  return {
    settings: game.room.settings,
    scores,
    progress: progress(state, players, rounds),
    turn: state.turn ? turnView(game, state.turn, userId) : null,
    last: state.turn?.phase === "done" && nextLead(state, players, rounds) === null,
  };
}

function turnView(game: HiLoContext, turn: HiLoTurn, userId: number): HiLoTurnView {
  const done = turn.phase === "done";
  const isLead = turn.leadId === userId;
  const person = (id: number) => ({ id, name: game.plainName(id) });
  return {
    no: turn.no,
    lead: person(turn.leadId),
    role: isLead ? "lead" : turn.guessers.includes(userId) ? "guesser" : "watcher",
    phase: turn.phase,
    endsAt: turn.endsAt,
    span: { picking: TIMING.pickMs, guessing: game.room.settings.seconds * 1000, done: TIMING.revealMs }[turn.phase],
    number: isLead || done ? turn.number : null,
    guessers: turn.guessers.map((id) => ({ ...person(id), guessed: turn.guesses[id] !== undefined, side: done ? (turn.guesses[id] ?? null) : null })),
    mine: turn.guesses[userId] ?? null,
    points: Object.entries(turn.points)
      .filter(([, points]) => points !== 0)
      .sort(([, a], [, b]) => b - a)
      .map(([id, points]) => ({ ...person(Number(id)), points })),
    skipReason: turn.skipReason,
  };
}
