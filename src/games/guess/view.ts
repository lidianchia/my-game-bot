import type { GuessContext } from "./render";
import { nextLead, progress, removalOf } from "./rules";
import { TIMING, type TabooTurn, type UniqueTurn } from "./types";
import type { GuessView, Points, TabooView, UniqueView } from "./view-types";

export type { GuessView, TabooView, UniqueView } from "./view-types";

function pointsList(game: GuessContext, points: Record<string, number>): Points[] {
  return Object.entries(points)
    .filter(([, value]) => value !== 0)
    .sort(([, a], [, b]) => b - a)
    .map(([userId, value]) => ({ id: Number(userId), name: game.plainName(Number(userId)), points: value }));
}

function tabooView(game: GuessContext, turn: TabooTurn, userId: number): TabooView {
  const isLead = turn.leadId === userId;
  const role = isLead ? "lead" : game.players().includes(userId) ? "player" : "watcher";
  return {
    mode: "taboo",
    no: turn.no,
    lead: { id: turn.leadId, name: game.plainName(turn.leadId) },
    role,
    phase: turn.phase,
    endsAt: turn.endsAt,
    span: turn.phase === "ready" ? TIMING.readyMs : turn.phase === "describing" ? game.room.settings.seconds * 1000 : null,
    card:
      turn.card && turn.phase === "describing"
        ? { ref: turn.results.length, word: isLead ? turn.card.word : null, taboo: isLead ? turn.card.taboo : [] }
        : null,
    results: turn.results.map((result) => ({
      word: result.card.word,
      outcome: result.outcome,
      by: result.by !== null ? game.plainName(result.by) : null,
    })),
    feed: turn.feed.map((item) => ({
      kind: item.kind,
      whoId: item.userId,
      who: game.plainName(item.userId),
      text: item.text,
      word: item.word ?? null,
      mine: item.userId === userId,
    })),
    points: pointsList(game, turn.points),
    skipReason: turn.skipReason,
  };
}

function uniqueView(game: GuessContext, turn: UniqueTurn, userId: number): UniqueView {
  const isLead = turn.leadId === userId;
  const role = isLead ? "lead" : turn.writers.includes(userId) ? "writer" : "watcher";
  const done = turn.phase === "done";

  // Writers that left mid-turn keep their clue, so list everyone who wrote one.
  const writerIds = [...turn.writers, ...Object.keys(turn.clues).map(Number).filter((id) => !turn.writers.includes(id))];
  const allClues = writerIds
    .filter((writer) => turn.clues[writer] !== undefined)
    .map((writer) => ({
      writer,
      name: game.plainName(writer),
      text: turn.clues[writer]!,
      removed: removalOf(turn, String(writer)),
      struckByMe: (turn.strikes[writer] ?? []).includes(userId),
    }));

  let clues: UniqueView["clues"] = null;
  if (done) clues = allClues;
  else if (isLead) clues = turn.phase === "guessing" ? allClues.filter((clue) => clue.removed === null) : null;
  else if (turn.phase !== "writing") clues = allClues;

  return {
    mode: "unique",
    no: turn.no,
    lead: { id: turn.leadId, name: game.plainName(turn.leadId) },
    role,
    phase: turn.phase,
    endsAt: turn.endsAt,
    span: { writing: TIMING.writeMs, reviewing: TIMING.reviewMs, guessing: TIMING.guessMs, done: null }[turn.phase],
    word: isLead && !done ? null : turn.card.word,
    writers: turn.writers.map((writer) => ({
      id: writer,
      name: game.plainName(writer),
      wrote: turn.clues[writer] !== undefined,
      confirmed: turn.confirmed.includes(writer),
    })),
    myClue: turn.clues[userId] ?? null,
    clues,
    guess: turn.guess,
    outcome: turn.outcome,
    accepted: turn.accepted,
    points: pointsList(game, turn.points),
    skipReason: turn.skipReason,
  };
}

export function guessView(game: GuessContext, userId: number): GuessView | null {
  const state = game.room.state;
  if (!state) return null;
  const players = game.players();
  const scores = Object.entries(state.scores)
    .map(([id, score]) => ({ id: Number(id), name: game.plainName(Number(id)), score }))
    .filter((entry) => players.includes(entry.id) || entry.score !== 0)
    .sort((a, b) => b.score - a.score || state.order.indexOf(a.id) - state.order.indexOf(b.id));
  const turn = state.turn;
  const rounds = game.room.settings.rounds;
  return {
    settings: game.room.settings,
    scores,
    progress: progress(state, players, rounds),
    turn: !turn ? null : turn.mode === "taboo" ? tabooView(game, turn, userId) : uniqueView(game, turn, userId),
    last: turn?.phase === "done" && nextLead(state, players, rounds) === null,
  };
}
