import type { Sql, SqlRow } from "../platform/sql";
import { SNAPSHOT_TABLES } from "./schema";

/**
 * When a Telegram group is upgraded to a supergroup it gets a new chat id,
 * which means a new Durable Object. The old object ships its history (members,
 * rooms, turn log) to the new one so /stats survives the upgrade.
 */
export interface ChatSnapshot {
  version: 1;
  tables: Record<string, SqlRow[]>;
}

/** kv keys worth carrying over; the rest (schema version, cached ids) belong to each object. */
const PORTABLE_KV_KEYS = new Set(["lang"]);

export function exportSnapshot(sql: Sql): ChatSnapshot {
  const tables: Record<string, SqlRow[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    const rows = sql.all(`SELECT * FROM ${table}`);
    tables[table] = table === "kv" ? rows.filter((row) => PORTABLE_KV_KEYS.has(String(row.key))) : rows;
  }
  return { version: 1, tables };
}

/** Imports into an untouched object only, so a late or repeated migration never clobbers live data. */
export function importSnapshot(sql: Sql, snapshot: ChatSnapshot): boolean {
  const hasRooms = sql.first(`SELECT 1 AS yes FROM rooms LIMIT 1`);
  if (hasRooms) return false;
  sql.transaction(() => {
    for (const table of SNAPSHOT_TABLES) {
      for (const row of snapshot.tables[table] ?? []) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        sql.run(
          `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          ...columns.map((column) => row[column] ?? null),
        );
      }
    }
  });
  return true;
}
