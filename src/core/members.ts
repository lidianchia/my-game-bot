import type { Sql } from "../platform/sql";
import type { TgUser } from "../telegram/intents";

/**
 * People the bot has seen in this chat. Telegram does not let bots list a
 * group's members, so this table is the only source for the invite picker.
 */
export interface Member {
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  dmOk: boolean;
  lastSeenAt: number;
}

type MemberRow = {
  user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  dm_ok: number;
  last_seen_at: number;
};

const toMember = (row: MemberRow): Member => ({
  userId: row.user_id,
  firstName: row.first_name,
  lastName: row.last_name,
  username: row.username,
  dmOk: row.dm_ok === 1,
  lastSeenAt: row.last_seen_at,
});

export function rememberUser(sql: Sql, user: TgUser, now: number): void {
  if (user.isBot) return;
  sql.run(
    `INSERT INTO members (user_id, first_name, last_name, username, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       last_seen_at = excluded.last_seen_at`,
    user.id,
    user.firstName,
    user.lastName ?? null,
    user.username ?? null,
    now,
  );
}

export function getMember(sql: Sql, userId: number): Member | undefined {
  const row = sql.first<MemberRow>(`SELECT * FROM members WHERE user_id = ?`, userId);
  return row ? toMember(row) : undefined;
}

export function findMemberByUsername(sql: Sql, username: string): Member | undefined {
  const row = sql.first<MemberRow>(
    `SELECT * FROM members WHERE username = ? COLLATE NOCASE`,
    username.replace(/^@/, ""),
  );
  return row ? toMember(row) : undefined;
}

export function recentMembers(sql: Sql, limit: number): Member[] {
  return sql
    .all<MemberRow>(`SELECT * FROM members ORDER BY last_seen_at DESC LIMIT ?`, limit)
    .map(toMember);
}

export function markDmReachable(sql: Sql, userId: number, reachable: boolean): void {
  sql.run(`UPDATE members SET dm_ok = ? WHERE user_id = ?`, reachable ? 1 : 0, userId);
}

const MAX_NAME_LENGTH = 24;

export function displayName(person: { firstName: string; lastName?: string | null; username?: string | null }): string {
  const full = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  const name = full || (person.username ? `@${person.username}` : "?");
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}

/** Display name for a user id, falling back to a neutral label for people the bot never saw. */
export function nameOf(sql: Sql, userId: number): string {
  const member = getMember(sql, userId);
  return member ? displayName(member) : `#${userId}`;
}
