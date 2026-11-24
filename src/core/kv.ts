import type { Sql } from "../platform/sql";

/** Small per-chat settings (language, cached chat id, bot username). */
export function getKv(sql: Sql, key: string): string | null {
  return sql.first<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, key)?.value ?? null;
}

export function setKv(sql: Sql, key: string, value: string): void {
  sql.run(
    `INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}
