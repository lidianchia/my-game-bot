import type { Sql } from "../platform/sql";

/**
 * The turn log: an append-only record of what happened in every room.
 * Each game stores its own JSON shape under its own `kind` values; summaries,
 * /log and /stats are all computed from these rows.
 */
export interface LogEntry<Data = unknown> {
  id: number;
  roomId: number;
  game: string;
  seq: number;
  actorId: number | null;
  kind: string;
  data: Data;
  createdAt: number;
}

type LogRow = {
  id: number;
  room_id: number;
  game: string;
  seq: number;
  actor_id: number | null;
  kind: string;
  data: string;
  created_at: number;
};

const toEntry = <Data>(row: LogRow): LogEntry<Data> => ({
  id: row.id,
  roomId: row.room_id,
  game: row.game,
  seq: row.seq,
  actorId: row.actor_id,
  kind: row.kind,
  data: JSON.parse(row.data) as Data,
  createdAt: row.created_at,
});

export function appendLog(
  sql: Sql,
  entry: { roomId: number; game: string; actorId: number | null; kind: string; data: unknown; now: number },
): number {
  const next = sql.first<{ seq: number }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM turn_log WHERE room_id = ?`,
    entry.roomId,
  )!.seq;
  sql.run(
    `INSERT INTO turn_log (room_id, game, seq, actor_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.roomId,
    entry.game,
    next,
    entry.actorId,
    entry.kind,
    JSON.stringify(entry.data),
    entry.now,
  );
  return next;
}

export function roomLog<Data>(sql: Sql, roomId: number, kind?: string): LogEntry<Data>[] {
  const rows = kind
    ? sql.all<LogRow>(`SELECT * FROM turn_log WHERE room_id = ? AND kind = ? ORDER BY seq`, roomId, kind)
    : sql.all<LogRow>(`SELECT * FROM turn_log WHERE room_id = ? ORDER BY seq`, roomId);
  return rows.map((row) => toEntry<Data>(row));
}

export function gameLog<Data>(sql: Sql, game: string, kind: string): LogEntry<Data>[] {
  return sql
    .all<LogRow>(`SELECT * FROM turn_log WHERE game = ? AND kind = ? ORDER BY room_id, seq`, game, kind)
    .map((row) => toEntry<Data>(row));
}
