import type { Lang } from "../../core/i18n";
import { gameLog, roomLog } from "../../core/turn-log";
import type { Sql } from "../../platform/sql";
import { esc } from "../../telegram/html";
import { signed } from "../../ui/glyphs";
import { hiLoMessages, type HiLoMessages } from "./i18n";
import { progress } from "./rules";
import { GAME_ID, TURN_LOG_KIND, type HiLoContext, type TurnRecord } from "./types";

/**
 * What the group sees in the chat: the live board in the room message, /log,
 * the summary when the game ends, and /stats. All of it is Telegram HTML:
 * `game.name()` is already escaped, anything else typed by people goes through `esc`.
 */

const msgs = (game: HiLoContext): HiLoMessages => hiLoMessages[game.lang];

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

/** The room message while playing and after the end: scores and whose turn it is. */
export function renderBoard(game: HiLoContext): string {
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
    lines.push(`${index + 1}. ${game.name(id)}　${signed(scores[id] ?? 0)}${current.has(id) ? "" : ` ${t.boardLeft}`}`);
  });
  const turn = state?.turn;
  if (state && turn && game.room.status === "playing") {
    const { total } = progress(state, game.players(), game.room.settings.rounds);
    lines.push("", t.boardTurn(turn.no, total, game.name(turn.leadId)));
  }
  if (game.room.status === "playing") lines.push("", t.boardFooter);
  return lines.join("\n");
}

/** /log: every turn of this room. */
export function renderLog(game: HiLoContext, emptyText: string): string {
  const t = msgs(game);
  const records = turnRecords(game.sql, game.room.id);
  if (records.length === 0) return emptyText;
  const lines = [t.logTitle(game.room.id, records.length), ""];
  for (const record of records) {
    const lead = game.name(record.leadId);
    lines.push(record.number === null ? t.logNoNumber(record.no, lead) : t.logTurn(record.no, lead, record.number));
    const calls = Object.entries(record.guesses).map(([userId, side]) => `${game.name(Number(userId))} ${t.sides[side]}`);
    if (calls.length) lines.push(t.logGuesses(calls.join(game.core.sep)));
    if (record.skipReason) lines.push(t.skipReason[record.skipReason]);
    const points = pointsLine((id) => game.name(id), record.points, game.core.sep);
    if (points) lines.push(t.logPoints(points));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function totals(records: TurnRecord[], seed: number[] = []): Map<number, number> {
  const points = new Map<number, number>(seed.map((id) => [id, 0]));
  for (const record of records) {
    for (const [userId, value] of Object.entries(record.points)) points.set(Number(userId), (points.get(Number(userId)) ?? 0) + value);
  }
  return points;
}

/** Posted in the group when the game ends; null if no turn was played. */
export function renderSummary(game: HiLoContext): string | null {
  const records = turnRecords(game.sql, game.room.id);
  if (records.length === 0) return null;
  const t = msgs(game);
  const started = game.room.startedAt ?? records[0]!.startedAt;
  const ended = game.room.endedAt ?? game.now();
  const ranked = [...totals(records, game.everyPlayer())].sort(([, a], [, b]) => b - a);
  return [
    t.summaryTitle(game.room.id),
    t.summaryMeta(records.length, Math.max(1, Math.round((ended - started) / 60_000))),
    "",
    t.rankingTitle,
    ...ranked.map(([userId, points], index) => `${index + 1}. ${t.rankingLine(game.name(userId), points)}`),
  ].join("\n");
}

/**
 * /stats across every game of this one played in the group, built from the turn
 * log alone. `names` gives plain names, so they're escaped here.
 */
export function renderStats(sql: Sql, lang: Lang, names: (userId: number) => string, focusUserId: number | null): string | null {
  const t = hiLoMessages[lang];
  const entries = gameLog<TurnRecord>(sql, GAME_ID, TURN_LOG_KIND);
  if (entries.length === 0) return null;
  const points = totals(entries.map((entry) => entry.data));
  const games = new Map<number, Set<number>>();
  for (const { roomId, data } of entries) {
    for (const userId of [data.leadId, ...Object.keys(data.guesses).map(Number)]) {
      const rooms = games.get(userId) ?? new Set<number>();
      rooms.add(roomId);
      games.set(userId, rooms);
      if (!points.has(userId)) points.set(userId, 0);
    }
  }
  const line = (userId: number) => t.statsLine(esc(names(userId)), points.get(userId) ?? 0, games.get(userId)?.size ?? 0);

  if (focusUserId !== null) {
    if (!points.has(focusUserId)) return null;
    return [t.personalTitle(esc(names(focusUserId))), line(focusUserId)].join("\n");
  }
  const ranked = [...points.keys()].sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0));
  return [t.statsTitle(new Set(entries.map((entry) => entry.roomId)).size, entries.length), ...ranked.map((id, index) => `${index + 1}. ${line(id)}`)].join(
    "\n",
  );
}
