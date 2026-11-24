import type { TgUser } from "../telegram/intents";
import { constantTimeEqual, hmacSha256, toHex, utf8 } from "./crypto";

/**
 * Telegram signs what it hands a Mini App (`Telegram.WebApp.initData`) with a
 * key derived from the bot token. Only a verified payload proves who is on the
 * other end; `initDataUnsafe` on the client proves nothing.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export interface VerifiedInitData {
  user: TgUser;
  /** The `startapp` value of the link the app was opened from. */
  startParam: string | null;
  /** When Telegram issued this payload (ms). */
  authDate: number;
}

/** A game page can stay open for an evening; after a day the user must reopen it from the group. */
export const INIT_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_INIT_DATA_LENGTH = 8192;

export async function verifyInitData(initData: string, botToken: string, now: number): Promise<VerifiedInitData | null> {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;

  // Every field except `hash` (including `signature`), sorted by key, as key=value lines.
  const fields = [...params].filter(([key]) => key !== "hash");
  if (new Set(fields.map(([key]) => key)).size !== fields.length) return null;
  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = fields.map(([key, value]) => `${key}=${value}`).join("\n");

  const secretKey = await hmacSha256(utf8("WebAppData"), utf8(botToken));
  const expected = toHex(await hmacSha256(secretKey, utf8(dataCheckString)));
  if (!constantTimeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date")) * 1000;
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (now - authDate > INIT_DATA_MAX_AGE_MS || authDate - now > CLOCK_SKEW_MS) return null;

  const user = parseUser(params.get("user"));
  if (!user) return null;
  return { user, startParam: params.get("start_param"), authDate };
}

function parseUser(raw: string | null): TgUser | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const id = record.id;
  const firstName = record.first_name;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  if (typeof firstName !== "string") return null;
  return {
    id,
    isBot: record.is_bot === true,
    firstName,
    lastName: typeof record.last_name === "string" ? record.last_name : undefined,
    username: typeof record.username === "string" ? record.username : undefined,
  };
}
