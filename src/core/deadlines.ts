import type { Sql } from "../platform/sql";

/**
 * Timers (vote windows, idle rooms). A Durable Object has a single alarm, so
 * every timer lives in this table and the alarm is always set to the earliest.
 */
export interface Deadline {
  id: number;
  roomId: number;
  kind: string;
  dueAt: number;
  data: Record<string, unknown>;
}

type DeadlineRow = { id: number; room_id: number; kind: string; due_at: number; data: string };

export function scheduleDeadline(
  sql: Sql,
  roomId: number,
  kind: string,
  dueAt: number,
  data: Record<string, unknown> = {},
): void {
  sql.run(
    `INSERT INTO deadlines (room_id, kind, due_at, data) VALUES (?, ?, ?, ?)`,
    roomId,
    kind,
    dueAt,
    JSON.stringify(data),
  );
}

export function cancelDeadlines(sql: Sql, roomId: number, kind?: string): void {
  if (kind) sql.run(`DELETE FROM deadlines WHERE room_id = ? AND kind = ?`, roomId, kind);
  else sql.run(`DELETE FROM deadlines WHERE room_id = ?`, roomId);
}

/** Removes and returns everything due, so a crash mid-processing never fires a timer twice. */
export function takeDueDeadlines(sql: Sql, now: number): Deadline[] {
  return sql.transaction(() => {
    const rows = sql.all<DeadlineRow>(`SELECT * FROM deadlines WHERE due_at <= ? ORDER BY due_at, id`, now);
    if (rows.length) sql.run(`DELETE FROM deadlines WHERE due_at <= ?`, now);
    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      kind: row.kind,
      dueAt: row.due_at,
      data: JSON.parse(row.data) as Record<string, unknown>,
    }));
  });
}

export function nextDeadlineAt(sql: Sql): number | null {
  return sql.first<{ due: number | null }>(`SELECT MIN(due_at) AS due FROM deadlines`)?.due ?? null;
}
