/**
 * Inline-button payloads look like `r12:go` or `r12:g:v:5:y`:
 *   r<roomId> : <action> [: <args>...]
 * Telegram caps callback_data at 64 bytes, so payloads stay terse and are
 * validated when built rather than failing at send time.
 */
const MAX_CALLBACK_BYTES = 64;

export interface RoomCallback {
  roomId: number;
  action: string;
  args: string[];
}

export function roomCallback(roomId: number, action: string, ...args: Array<string | number>): string {
  const data = [`r${roomId}`, action, ...args.map(String)].join(":");
  if (new TextEncoder().encode(data).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data over ${MAX_CALLBACK_BYTES} bytes: ${data}`);
  }
  return data;
}

/** A button in a game's settings panel: `r<room>:st:<args>`; the press runs the game's `applySetting(settings, args)`. */
export function settingCallback(roomId: number, ...args: Array<string | number>): string {
  return roomCallback(roomId, "st", ...args);
}

export function parseRoomCallback(data: string): RoomCallback | null {
  const [head, action, ...args] = data.split(":");
  const match = head ? /^r(\d+)$/.exec(head) : null;
  if (!match || !action) return null;
  return { roomId: Number(match[1]), action, args };
}

/** Settings and other chat-level buttons that are not tied to a room: `x:<action>:<args>`. */
export function chatCallback(action: string, ...args: Array<string | number>): string {
  const data = ["x", action, ...args.map(String)].join(":");
  if (new TextEncoder().encode(data).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data over ${MAX_CALLBACK_BYTES} bytes: ${data}`);
  }
  return data;
}

export function parseChatCallback(data: string): { action: string; args: string[] } | null {
  const [head, action, ...args] = data.split(":");
  if (head !== "x" || !action) return null;
  return { action, args };
}
