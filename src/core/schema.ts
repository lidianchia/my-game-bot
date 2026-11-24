import type { Sql } from "../platform/sql";

/**
 * Schema for one chat's Durable Object (so no table needs a chat_id column).
 * Migrations are append-only: add a new array entry, never edit a shipped one.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS members (
       user_id INTEGER PRIMARY KEY,
       first_name TEXT NOT NULL,
       last_name TEXT,
       username TEXT,
       dm_ok INTEGER NOT NULL DEFAULT 0,
       last_seen_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS members_by_username ON members (username COLLATE NOCASE)`,
    `CREATE TABLE IF NOT EXISTS rooms (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       game TEXT NOT NULL,
       status TEXT NOT NULL,
       host_id INTEGER NOT NULL,
       thread_id INTEGER,
       message_id INTEGER,
       pinned INTEGER NOT NULL DEFAULT 0,
       view TEXT NOT NULL DEFAULT 'main',
       settings TEXT NOT NULL,
       state TEXT,
       created_at INTEGER NOT NULL,
       started_at INTEGER,
       ended_at INTEGER,
       end_reason TEXT,
       last_activity_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS room_players (
       room_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       status TEXT NOT NULL,
       joined_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (room_id, user_id)
     )`,
    `CREATE TABLE IF NOT EXISTS invite_batches (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       room_id INTEGER NOT NULL,
       message_id INTEGER,
       invited_by INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS invitations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       batch_id INTEGER NOT NULL,
       room_id INTEGER NOT NULL,
       user_id INTEGER,
       username TEXT,
       label TEXT NOT NULL,
       status TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       responded_at INTEGER
     )`,
    `CREATE INDEX IF NOT EXISTS invitations_by_room ON invitations (room_id, status)`,
    `CREATE TABLE IF NOT EXISTS join_requests (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       room_id INTEGER NOT NULL,
       user_id INTEGER NOT NULL,
       status TEXT NOT NULL,
       message_id INTEGER,
       created_at INTEGER NOT NULL,
       decided_at INTEGER,
       decided_by INTEGER
     )`,
    `CREATE TABLE IF NOT EXISTS pickers (
       message_id INTEGER PRIMARY KEY,
       room_id INTEGER NOT NULL,
       mode TEXT NOT NULL,
       selected TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS turn_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       room_id INTEGER NOT NULL,
       game TEXT NOT NULL,
       seq INTEGER NOT NULL,
       actor_id INTEGER,
       kind TEXT NOT NULL,
       data TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS turn_log_by_room ON turn_log (room_id, seq)`,
    `CREATE INDEX IF NOT EXISTS turn_log_by_game ON turn_log (game, kind)`,
    `CREATE TABLE IF NOT EXISTS deadlines (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       room_id INTEGER NOT NULL,
       kind TEXT NOT NULL,
       due_at INTEGER NOT NULL,
       data TEXT NOT NULL DEFAULT '{}'
     )`,
    `CREATE INDEX IF NOT EXISTS deadlines_by_due ON deadlines (due_at)`,
    `CREATE TABLE IF NOT EXISTS processed_updates (
       update_id INTEGER PRIMARY KEY,
       seen_at INTEGER NOT NULL
     )`,
  ],
];

export function migrate(sql: Sql): void {
  sql.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = sql.first<{ value: string }>(`SELECT value FROM kv WHERE key = 'schema_version'`);
  const current = row ? Number(row.value) : 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    sql.transaction(() => {
      for (const statement of MIGRATIONS[version]!) sql.run(statement);
      sql.run(
        `INSERT INTO kv (key, value) VALUES ('schema_version', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        String(version + 1),
      );
    });
  }
}

/** Tables copied when a group is upgraded to a supergroup and changes chat id. */
export const SNAPSHOT_TABLES = [
  "kv",
  "members",
  "rooms",
  "room_players",
  "invite_batches",
  "invitations",
  "join_requests",
  "turn_log",
] as const;
