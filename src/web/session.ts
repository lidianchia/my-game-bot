import { constantTimeEqual, fromBase64Url, hmacSha256, toBase64Url, utf8 } from "./crypto";

/**
 * After the Worker has verified a Mini App launch, it hands the page a short
 * signed token for its WebSocket. The token names who is playing and in which
 * room, so reconnects skip the full check and no Telegram data ends up in URLs.
 */
export interface Session {
  userId: number;
  chatId: number;
  roomId: number;
  expiresAt: number;
}

export const SESSION_MS = 12 * 60 * 60 * 1000;

/** Derived from the webhook secret so a leaked session key can't be used to forge webhook calls. */
async function sessionKey(secret: string): Promise<Uint8Array<ArrayBuffer>> {
  return hmacSha256(utf8(secret), utf8("mini-app-session-v1"));
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const body = [session.userId, session.chatId, session.roomId, session.expiresAt];
  const payload = toBase64Url(utf8(JSON.stringify(body)));
  const signature = toBase64Url(await hmacSha256(await sessionKey(secret), utf8(payload)));
  return `${payload}.${signature}`;
}

export async function verifySession(token: string | null, secret: string, now: number): Promise<Session | null> {
  if (!token || token.length > 512 || !secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = toBase64Url(await hmacSha256(await sessionKey(secret), utf8(payload)));
  if (!constantTimeEqual(expected, signature)) return null;

  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body.length !== 4 || !body.every((value) => Number.isSafeInteger(value))) return null;
  const [userId, chatId, roomId, expiresAt] = body as [number, number, number, number];
  if (expiresAt <= now) return null;
  return { userId, chatId, roomId, expiresAt };
}
