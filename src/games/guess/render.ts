import type { GameContext } from "../../core/game";
import type { Lang } from "../../core/i18n";
import { gameLog, roomLog } from "../../core/turn-log";
import type { Sql } from "../../platform/sql";
import { esc } from "../../telegram/html";
import { G, signed } from "../../ui/glyphs";
import { guessMessages, type GuessMessages } from "./i18n";
import { progress } from "./rules";
import { TURN_LOG_KIND, type GuessSettings, type GuessState, type TabooCardResult, type TurnRecord } from "./types";

export type GuessContext = GameContext<GuessSettings, GuessState>;

const msgs = (game: GuessContext): GuessMessages => guessMessages[game.lang];

export function turnRecords(sql: Sql, roomId: number): TurnRecord[] {
  return roomLog<TurnRecord>(sql, roomId, TURN_LOG_KIND).map((entry) => entry.data);
}

function pointsLine(names: (userId: number) => string, points: Record<string, number>, sep: string): string | null {
  const parts = Object.entries(points)
    .filter(([, value]) => value !== 0)
    .sort(([, a], [, b]) => b - a)
    .map(([userId, value]) => `${names(Number(userId))} ${signed(value)}`);
  return parts.length ? parts.join(sep) : null;
}

// ------------------------------------------------------------------ board

/** Live board in the room message: scores and whose turn it is. The game itself happens in the page. */
export function renderBoard(game: GuessContext): string {
  const t = msgs(game);
  const state = game.room.state;
  const current = new Set(game.players());
  const scores = state?.scores ?? {};
  const ranked = game
    .everyPlayer()
    .filter((id) => current.has(id) || (scores[id] ?? 0) !== 0)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

  const lines = [t.boardScores];
  ranked.forEach((id, index) => {
    const left = current.has(id) ? "" : ` ${t.boardLeft}`;
    lines.push(`${index + 1}. ${game.name(id)}　${signed(scores[id] ?? 0)}${left}`);
  });

  const turn = state?.turn;
  if (state && turn && game.room.status === "playing") {
    const { total } = progress(state, game.players(), game.room.settings.rounds);
    const lead = game.name(turn.leadId);
    lines.push("", turn.mode === "taboo" ? t.boardTaboo(turn.no, total, lead) : t.boardUnique(turn.no, total, lead));
    if (turn.phase === "done") lines.push(t.boardTurnDone);
  }
  if (game.room.status === "playing") lines.push("", t.boardFooter);
  return lines.join("\n");
}

// ------------------------------------------------------------------- /log

function cardResult(game: GuessContext, t: GuessMessages, result: TabooCardResult): string {
  const word = esc(result.card.word);
  if (result.outcome === "guessed") return `${word} ${G.check}${result.by !== null ? t.logGuessedBy(game.name(result.by)) : ""}`;
  if (result.outcome === "buzzed") return `<s>${word}</s> ${t.tabooOutcome.buzzed}${result.by !== null ? t.logBuzzedBy(game.name(result.by)) : ""}`;
  return `<s>${word}</s> ${t.tabooOutcome[result.outcome]}`;
}

export function renderLog(game: GuessContext, emptyText: string): string {
  const t = msgs(game);
  const records = turnRecords(game.sql, game.room.id);
  if (records.length === 0) return emptyText;
  const lines = [t.logTitle(game.room.id, records.length), ""];
  for (const record of records) {
    if (record.mode === "taboo") {
      lines.push(t.logTaboo(record.no, game.name(record.leadId)));
      if (record.results.length) lines.push(record.results.map((result) => cardResult(game, t, result)).join(game.core.sep));
      else if (!record.skipReason) lines.push(t.logNoCards);
    } else {
      lines.push(t.logUnique(record.no, game.name(record.leadId)), t.logWord(esc(record.card.word)));
      const clues = Object.entries(record.clues).map(([writer, clue]) => {
        const why = record.removed[writer];
        return why ? `<s>${esc(clue)}</s>${t.logRemoved[why]}` : esc(clue);
      });
      if (clues.length) lines.push(t.logClues(clues.join(game.core.sep)));
      else lines.push(t.logNoClues);
      if (record.outcome) {
        const verdict = t.uniqueOutcome[record.outcome] + (record.accepted ? t.logAccepted : "");
        lines.push(record.guess !== null ? t.logGuess(esc(record.guess), verdict) : verdict);
      }
    }
    if (record.skipReason) lines.push(t.skipReason[record.skipReason]);
    const points = pointsLine((id) => game.name(id), record.points, game.core.sep);
    if (points) lines.push(t.logPoints(points));
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------- tallies

interface Tally {
  userId: number;
  points: number;
  /** Off-limits words guessed while this person described. */
  described: number;
  /** Off-limits words this person guessed. */
  guessed: number;
  /** Unique Clues turns this person guessed right. */
  solved: number;
  /** This person's clues that survived. */
  clues: number;
  turns: number;
}

const emptyTally = (userId: number): Tally => ({ userId, points: 0, described: 0, guessed: 0, solved: 0, clues: 0, turns: 0 });

function tally(records: TurnRecord[], seed: number[] = []): Map<number, Tally> {
  const tallies = new Map<number, Tally>(seed.map((id) => [id, emptyTally(id)]));
  const of = (userId: number) => {
    const existing = tallies.get(userId);
    if (existing) return existing;
    const created = emptyTally(userId);
    tallies.set(userId, created);
    return created;
  };
  for (const record of records) {
    for (const [userId, points] of Object.entries(record.points)) of(Number(userId)).points += points;
    of(record.leadId).turns += 1;
    if (record.mode === "taboo") {
      for (const result of record.results) {
        if (result.outcome !== "guessed") continue;
        of(record.leadId).described += 1;
        if (result.by !== null) of(result.by).guessed += 1;
      }
    } else {
      if (record.outcome === "correct") of(record.leadId).solved += 1;
      for (const writer of Object.keys(record.clues)) if (!record.removed[writer]) of(Number(writer)).clues += 1;
    }
  }
  return tallies;
}

const byPoints = (a: Tally, b: Tally) => b.points - a.points || b.described + b.guessed - (a.described + a.guessed);

// ---------------------------------------------------------- end summary

export function renderSummary(game: GuessContext): string | null {
  const records = turnRecords(game.sql, game.room.id);
  if (records.length === 0) return null;
  const t = msgs(game);
  const tallies = [...tally(records, game.everyPlayer()).values()].sort(byPoints);
  const started = game.room.startedAt ?? records[0]!.startedAt;
  const ended = game.room.endedAt ?? game.now();

  const lines = [t.summaryTitle(game.room.id), t.summaryMeta(records.length, t.duration(ended - started)), "", t.rankingTitle];
  tallies.forEach((entry, index) => lines.push(`${index + 1}. ${t.rankingLine(game.name(entry.userId), entry.points)}`));

  const top = (pick: (entry: Tally) => number) => [...tallies].sort((a, b) => pick(b) - pick(a)).find((entry) => pick(entry) > 0);
  const highlights: string[] = [];
  const describer = top((entry) => entry.described);
  if (describer) highlights.push(t.bestDescriber(game.name(describer.userId), describer.described));
  const guesser = top((entry) => entry.guessed);
  if (guesser) highlights.push(t.bestGuesser(game.name(guesser.userId), guesser.guessed));
  const original = top((entry) => entry.clues);
  if (original) highlights.push(t.mostUnique(game.name(original.userId), original.clues));
  const uniqueTurns = records.filter((record) => record.mode === "unique" && record.outcome !== null);
  if (uniqueTurns.length) {
    const solved = uniqueTurns.filter((record) => record.mode === "unique" && record.outcome === "correct").length;
    highlights.push(t.solvedRate(solved, uniqueTurns.length));
  }
  if (highlights.length) lines.push("", t.highlightsTitle, ...highlights);
  return lines.join("\n");
}

// ------------------------------------------------------------------ /stats

export function renderStats(sql: Sql, lang: Lang, names: (userId: number) => string, focusUserId: number | null): string | null {
  const t = guessMessages[lang];
  const entries = gameLog<TurnRecord>(sql, "guess", TURN_LOG_KIND);
  if (entries.length === 0) return null;
  const memberships = sql.all<{ room_id: number; status: string; user_id: number }>(
    `SELECT r.id AS room_id, r.status AS status, rp.user_id AS user_id
       FROM rooms r JOIN room_players rp ON rp.room_id = r.id
      WHERE r.game = 'guess' AND r.started_at IS NOT NULL`,
  );

  const tallies = tally(entries.map((entry) => entry.data));
  const gamesPlayed = new Map<number, Set<number>>();
  for (const row of memberships) {
    if (!tallies.has(row.user_id)) tallies.set(row.user_id, emptyTally(row.user_id));
    const rooms = gamesPlayed.get(row.user_id) ?? new Set<number>();
    rooms.add(row.room_id);
    gamesPlayed.set(row.user_id, rooms);
  }

  // A win = top score (above zero) in a finished room; ties share it.
  const endedRooms = new Set(memberships.filter((row) => row.status === "ended").map((row) => row.room_id));
  const roomScores = new Map<number, Map<number, number>>();
  for (const entry of entries) {
    if (!endedRooms.has(entry.roomId)) continue;
    const scores = roomScores.get(entry.roomId) ?? new Map<number, number>();
    for (const [userId, points] of Object.entries(entry.data.points)) {
      scores.set(Number(userId), (scores.get(Number(userId)) ?? 0) + points);
    }
    roomScores.set(entry.roomId, scores);
  }
  const wins = new Map<number, number>();
  for (const scores of roomScores.values()) {
    if (scores.size === 0) continue;
    const best = Math.max(...scores.values());
    if (best <= 0) continue;
    for (const [userId, score] of scores) if (score === best) wins.set(userId, (wins.get(userId) ?? 0) + 1);
  }

  const lineFor = (entry: Tally) => [
    t.statsLine(esc(names(entry.userId)), entry.points, gamesPlayed.get(entry.userId)?.size ?? 0, wins.get(entry.userId) ?? 0),
    t.statsDetail(entry.described, entry.guessed, entry.solved, entry.clues),
  ];

  if (focusUserId !== null) {
    const entry = tallies.get(focusUserId);
    if (!entry) return null;
    return [t.personalTitle(esc(names(focusUserId))), ...lineFor(entry)].join("\n");
  }

  const gameCount = new Set(entries.map((entry) => entry.roomId)).size;
  const lines = [t.statsTitle(gameCount, entries.length)];
  [...tallies.values()].sort(byPoints).forEach((entry, index) => {
    const [main, detail] = lineFor(entry);
    lines.push(`${index + 1}. ${main}`, detail!);
  });
  return lines.join("\n");
}
