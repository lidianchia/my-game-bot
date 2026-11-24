import type { Sql } from "../platform/sql";
import type { TgUser } from "../telegram/intents";

export type RoomStatus = "lobby" | "playing" | "ended";
/** Which keyboard the room message currently shows. Only the host can switch away from "main". */
export type RoomView = "main" | "settings" | "confirm-end";
export type EndReason = "host" | "admin" | "idle" | "empty" | "disbanded" | "migrated" | "finished";

export interface Room<Settings = unknown, State = unknown> {
  id: number;
  game: string;
  status: RoomStatus;
  hostId: number;
  threadId: number | null;
  messageId: number | null;
  pinned: boolean;
  view: RoomView;
  settings: Settings;
  state: State | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  lastActivityAt: number;
}

type RoomRow = {
  id: number;
  game: string;
  status: string;
  host_id: number;
  thread_id: number | null;
  message_id: number | null;
  pinned: number;
  view: string;
  settings: string;
  state: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  end_reason: string | null;
  last_activity_at: number;
};

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    game: row.game,
    status: row.status as RoomStatus,
    hostId: row.host_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    pinned: row.pinned === 1,
    view: row.view as RoomView,
    settings: JSON.parse(row.settings),
    state: row.state ? JSON.parse(row.state) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason: row.end_reason as EndReason | null,
    lastActivityAt: row.last_activity_at,
  };
}

export function createRoom(
  sql: Sql,
  input: { game: string; hostId: number; threadId: number | null; settings: unknown; now: number },
): Room {
  const row = sql.first<RoomRow>(
    `INSERT INTO rooms (game, status, host_id, thread_id, settings, created_at, last_activity_at)
     VALUES (?, 'lobby', ?, ?, ?, ?, ?) RETURNING *`,
    input.game,
    input.hostId,
    input.threadId,
    JSON.stringify(input.settings),
    input.now,
    input.now,
  );
  if (!row) throw new Error("room insert returned nothing");
  return toRoom(row);
}

export function loadRoom(sql: Sql, roomId: number): Room | undefined {
  const row = sql.first<RoomRow>(`SELECT * FROM rooms WHERE id = ?`, roomId);
  return row ? toRoom(row) : undefined;
}

/** The chat's open room, if any. One room at a time keeps button routing unambiguous. */
export function activeRoom(sql: Sql): Room | undefined {
  const row = sql.first<RoomRow>(`SELECT * FROM rooms WHERE status != 'ended' ORDER BY id DESC LIMIT 1`);
  return row ? toRoom(row) : undefined;
}

/** Most recent room that actually started, used by /log after a game has ended. */
export function latestPlayedRoom(sql: Sql): Room | undefined {
  const row = sql.first<RoomRow>(
    `SELECT * FROM rooms WHERE started_at IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  return row ? toRoom(row) : undefined;
}

export function saveRoom(sql: Sql, room: Room): void {
  sql.run(
    `UPDATE rooms SET status = ?, host_id = ?, thread_id = ?, message_id = ?, pinned = ?, view = ?,
       settings = ?, state = ?, started_at = ?, ended_at = ?, end_reason = ?, last_activity_at = ?
     WHERE id = ?`,
    room.status,
    room.hostId,
    room.threadId,
    room.messageId,
    room.pinned ? 1 : 0,
    room.view,
    JSON.stringify(room.settings),
    room.state === null ? null : JSON.stringify(room.state),
    room.startedAt,
    room.endedAt,
    room.endReason,
    room.lastActivityAt,
    room.id,
  );
}

// ---------------------------------------------------------------- players

export type PlayerStatus = "joined" | "left" | "kicked";

export function addPlayer(sql: Sql, roomId: number, userId: number, now: number): void {
  sql.run(
    `INSERT INTO room_players (room_id, user_id, status, joined_at, updated_at)
     VALUES (?, ?, 'joined', ?, ?)
     ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'joined', joined_at = excluded.joined_at,
       updated_at = excluded.updated_at`,
    roomId,
    userId,
    now,
    now,
  );
}

export function setPlayerStatus(sql: Sql, roomId: number, userId: number, status: PlayerStatus, now: number): void {
  sql.run(
    `UPDATE room_players SET status = ?, updated_at = ? WHERE room_id = ? AND user_id = ?`,
    status,
    now,
    roomId,
    userId,
  );
}

/** Current players, earliest joiner first (that order decides who inherits the host role). */
export function joinedPlayers(sql: Sql, roomId: number): number[] {
  return sql
    .all<{ user_id: number }>(
      `SELECT user_id FROM room_players WHERE room_id = ? AND status = 'joined' ORDER BY joined_at, user_id`,
      roomId,
    )
    .map((row) => row.user_id);
}

/** Everyone who was ever in the room, including people who left; used for summaries and stats. */
export function everyPlayer(sql: Sql, roomId: number): number[] {
  return sql
    .all<{ user_id: number }>(`SELECT user_id FROM room_players WHERE room_id = ? ORDER BY joined_at`, roomId)
    .map((row) => row.user_id);
}

export function isJoined(sql: Sql, roomId: number, userId: number): boolean {
  return !!sql.first(
    `SELECT 1 AS yes FROM room_players WHERE room_id = ? AND user_id = ? AND status = 'joined'`,
    roomId,
    userId,
  );
}

// ------------------------------------------------------------ invitations

export type InvitationStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface Invitation {
  id: number;
  batchId: number;
  roomId: number;
  userId: number | null;
  username: string | null;
  label: string;
  status: InvitationStatus;
}

type InvitationRow = {
  id: number;
  batch_id: number;
  room_id: number;
  user_id: number | null;
  username: string | null;
  label: string;
  status: string;
};

const toInvitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  batchId: row.batch_id,
  roomId: row.room_id,
  userId: row.user_id,
  username: row.username,
  label: row.label,
  status: row.status as InvitationStatus,
});

export function createInviteBatch(sql: Sql, roomId: number, invitedBy: number, now: number): number {
  const row = sql.first<{ id: number }>(
    `INSERT INTO invite_batches (room_id, invited_by, created_at) VALUES (?, ?, ?) RETURNING id`,
    roomId,
    invitedBy,
    now,
  );
  return row!.id;
}

export function setInviteBatchMessage(sql: Sql, batchId: number, messageId: number): void {
  sql.run(`UPDATE invite_batches SET message_id = ? WHERE id = ?`, messageId, batchId);
}

export function inviteBatch(sql: Sql, batchId: number): { id: number; roomId: number; messageId: number | null; invitedBy: number } | undefined {
  const row = sql.first<{ id: number; room_id: number; message_id: number | null; invited_by: number }>(
    `SELECT * FROM invite_batches WHERE id = ?`,
    batchId,
  );
  return row ? { id: row.id, roomId: row.room_id, messageId: row.message_id, invitedBy: row.invited_by } : undefined;
}

export function addInvitation(
  sql: Sql,
  input: { batchId: number; roomId: number; userId: number | null; username: string | null; label: string; now: number },
): void {
  sql.run(
    `INSERT INTO invitations (batch_id, room_id, user_id, username, label, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    input.batchId,
    input.roomId,
    input.userId,
    input.username,
    input.label,
    input.now,
  );
}

export function batchInvitations(sql: Sql, batchId: number): Invitation[] {
  return sql.all<InvitationRow>(`SELECT * FROM invitations WHERE batch_id = ? ORDER BY id`, batchId).map(toInvitation);
}

export function pendingInvitations(sql: Sql, roomId: number): Invitation[] {
  return sql
    .all<InvitationRow>(`SELECT * FROM invitations WHERE room_id = ? AND status = 'pending' ORDER BY id`, roomId)
    .map(toInvitation);
}

/**
 * Invitations made with a bare @username have no user id until that person
 * taps a button, so matching falls back to the username they tap with.
 */
export function invitationFor(sql: Sql, batchId: number, user: TgUser): Invitation | undefined {
  return batchInvitations(sql, batchId).find(
    (invite) =>
      invite.userId === user.id ||
      (invite.userId === null &&
        !!invite.username &&
        !!user.username &&
        invite.username.toLowerCase() === user.username.toLowerCase()),
  );
}

export function hasPendingInvitation(sql: Sql, roomId: number, user: { id: number; username?: string | null }): Invitation | undefined {
  return pendingInvitations(sql, roomId).find(
    (invite) =>
      invite.userId === user.id ||
      (invite.userId === null &&
        !!invite.username &&
        !!user.username &&
        invite.username.toLowerCase() === user.username.toLowerCase()),
  );
}

export function respondToInvitation(
  sql: Sql,
  invitationId: number,
  status: Exclude<InvitationStatus, "pending">,
  userId: number,
  now: number,
): void {
  sql.run(
    `UPDATE invitations SET status = ?, user_id = ?, responded_at = ? WHERE id = ?`,
    status,
    userId,
    now,
    invitationId,
  );
}

export function cancelPendingInvitations(sql: Sql, roomId: number, now: number): void {
  sql.run(
    `UPDATE invitations SET status = 'cancelled', responded_at = ? WHERE room_id = ? AND status = 'pending'`,
    now,
    roomId,
  );
}

// ---------------------------------------------------------- join requests

export type RequestStatus = "pending" | "approved" | "denied" | "cancelled";

export interface JoinRequest {
  id: number;
  roomId: number;
  userId: number;
  status: RequestStatus;
  messageId: number | null;
}

type RequestRow = { id: number; room_id: number; user_id: number; status: string; message_id: number | null };

const toRequest = (row: RequestRow): JoinRequest => ({
  id: row.id,
  roomId: row.room_id,
  userId: row.user_id,
  status: row.status as RequestStatus,
  messageId: row.message_id,
});

export function createJoinRequest(sql: Sql, roomId: number, userId: number, now: number): number {
  return sql.first<{ id: number }>(
    `INSERT INTO join_requests (room_id, user_id, status, created_at) VALUES (?, ?, 'pending', ?) RETURNING id`,
    roomId,
    userId,
    now,
  )!.id;
}

export function setRequestMessage(sql: Sql, requestId: number, messageId: number): void {
  sql.run(`UPDATE join_requests SET message_id = ? WHERE id = ?`, messageId, requestId);
}

export function getJoinRequest(sql: Sql, requestId: number): JoinRequest | undefined {
  const row = sql.first<RequestRow>(`SELECT * FROM join_requests WHERE id = ?`, requestId);
  return row ? toRequest(row) : undefined;
}

export function pendingRequestFor(sql: Sql, roomId: number, userId: number): JoinRequest | undefined {
  const row = sql.first<RequestRow>(
    `SELECT * FROM join_requests WHERE room_id = ? AND user_id = ? AND status = 'pending'`,
    roomId,
    userId,
  );
  return row ? toRequest(row) : undefined;
}

export function pendingRequests(sql: Sql, roomId: number): JoinRequest[] {
  return sql
    .all<RequestRow>(`SELECT * FROM join_requests WHERE room_id = ? AND status = 'pending' ORDER BY id`, roomId)
    .map(toRequest);
}

export function decideJoinRequest(
  sql: Sql,
  requestId: number,
  status: Exclude<RequestStatus, "pending">,
  decidedBy: number | null,
  now: number,
): void {
  sql.run(
    `UPDATE join_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    status,
    decidedBy,
    now,
    requestId,
  );
}

export function cancelPendingRequests(sql: Sql, roomId: number, now: number): void {
  sql.run(
    `UPDATE join_requests SET status = 'cancelled', decided_at = ? WHERE room_id = ? AND status = 'pending'`,
    now,
    roomId,
  );
}

// ---------------------------------------------------------------- pickers

export type PickerMode = "invite" | "kick";

export interface Picker {
  messageId: number;
  roomId: number;
  mode: PickerMode;
  selected: number[];
}

export function createPicker(sql: Sql, messageId: number, roomId: number, mode: PickerMode, now: number): void {
  sql.run(
    `INSERT INTO pickers (message_id, room_id, mode, selected, created_at) VALUES (?, ?, ?, '[]', ?)`,
    messageId,
    roomId,
    mode,
    now,
  );
}

export function getPicker(sql: Sql, messageId: number): Picker | undefined {
  const row = sql.first<{ message_id: number; room_id: number; mode: string; selected: string }>(
    `SELECT * FROM pickers WHERE message_id = ?`,
    messageId,
  );
  return row
    ? { messageId: row.message_id, roomId: row.room_id, mode: row.mode as PickerMode, selected: JSON.parse(row.selected) }
    : undefined;
}

export function savePickerSelection(sql: Sql, messageId: number, selected: number[]): void {
  sql.run(`UPDATE pickers SET selected = ? WHERE message_id = ?`, JSON.stringify(selected), messageId);
}

export function deletePicker(sql: Sql, messageId: number): void {
  sql.run(`DELETE FROM pickers WHERE message_id = ?`, messageId);
}
