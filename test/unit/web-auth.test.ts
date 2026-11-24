import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INIT_DATA_MAX_AGE_MS, verifyInitData } from "../../src/web/init-data";
import { signSession, verifySession } from "../../src/web/session";
import { parseStartParam, webStartParam } from "../../src/web/start-param";

const BOT_TOKEN = "123456:test-token";
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

/**
 * Signs Mini App launch data the way Telegram documents it, with node:crypto
 * rather than the Web Crypto code under test, so a mistake in one shows up.
 */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function launch(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(NOW / 1000) - 60),
    chat_instance: "-8410259376582943",
    chat_type: "supergroup",
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    signature: "c2lnbmF0dXJlIGZvciB0aGlyZCBwYXJ0aWVz",
    start_param: "g1001234567890r7",
    user: JSON.stringify({ id: 101, first_name: "Alice", last_name: "Liu", username: "alice", language_code: "zh-hans" }),
    ...overrides,
  };
}

describe("Mini App launch data", () => {
  it("accepts what Telegram signed and says who opened the page from which link", async () => {
    const verified = await verifyInitData(signInitData(launch()), BOT_TOKEN, NOW);
    expect(verified).toMatchObject({
      user: { id: 101, isBot: false, firstName: "Alice", lastName: "Liu", username: "alice" },
      startParam: "g1001234567890r7",
    });
  });

  it("handles names with spaces, plus signs and non-Latin text", async () => {
    const user = JSON.stringify({ id: 102, first_name: "沒天 鋰了+1 &=?" });
    const verified = await verifyInitData(signInitData(launch({ user })), BOT_TOKEN, NOW);
    expect(verified?.user.firstName).toBe("沒天 鋰了+1 &=?");
  });

  it("rejects anything tampered with or signed for another bot", async () => {
    const genuine = signInitData(launch());
    const impostor = new URLSearchParams(genuine);
    impostor.set("user", JSON.stringify({ id: 666, first_name: "Mallory" }));
    expect(await verifyInitData(impostor.toString(), BOT_TOKEN, NOW)).toBeNull();

    const params = new URLSearchParams(genuine);
    params.set("start_param", "g1001234567890r8"); // someone else's room
    expect(await verifyInitData(params.toString(), BOT_TOKEN, NOW)).toBeNull();

    expect(await verifyInitData(signInitData(launch(), "999:other-bot"), BOT_TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(genuine, "", NOW)).toBeNull();
  });

  it("rejects malformed data", async () => {
    const withoutHash = new URLSearchParams(signInitData(launch()));
    withoutHash.delete("hash");
    expect(await verifyInitData(withoutHash.toString(), BOT_TOKEN, NOW)).toBeNull();
    expect(await verifyInitData("", BOT_TOKEN, NOW)).toBeNull();
    expect(await verifyInitData("hash=zz", BOT_TOKEN, NOW)).toBeNull();

    const duplicated = `${signInitData(launch())}&user=${encodeURIComponent('{"id":1,"first_name":"Mallory"}')}`;
    expect(await verifyInitData(duplicated, BOT_TOKEN, NOW)).toBeNull();

    const noUser = launch();
    delete noUser.user;
    expect(await verifyInitData(signInitData(noUser), BOT_TOKEN, NOW)).toBeNull();
    const badId = await verifyInitData(signInitData(launch({ user: JSON.stringify({ id: "101", first_name: "A" }) })), BOT_TOKEN, NOW);
    expect(badId).toBeNull();
  });

  it("expires a day after launch and refuses launches from the future", async () => {
    const old = launch({ auth_date: String(Math.floor((NOW - INIT_DATA_MAX_AGE_MS) / 1000) - 1) });
    expect(await verifyInitData(signInitData(old), BOT_TOKEN, NOW)).toBeNull();
    const future = launch({ auth_date: String(Math.floor(NOW / 1000) + 3600) });
    expect(await verifyInitData(signInitData(future), BOT_TOKEN, NOW)).toBeNull();
    const fresh = launch({ auth_date: String(Math.floor((NOW - INIT_DATA_MAX_AGE_MS) / 1000) + 60) });
    expect(await verifyInitData(signInitData(fresh), BOT_TOKEN, NOW)).not.toBeNull();
  });
});

describe("session tokens", () => {
  const session = { userId: 101, chatId: -1001234567890, roomId: 7, expiresAt: NOW + 60_000 };

  it("round-trip until they expire", async () => {
    const token = await signSession(session, "webhook-secret");
    expect(await verifySession(token, "webhook-secret", NOW)).toEqual(session);
    expect(await verifySession(token, "webhook-secret", NOW + 60_000)).toBeNull();
  });

  it("can't be forged or reused with another secret", async () => {
    const token = await signSession(session, "webhook-secret");
    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify([102, session.chatId, session.roomId, session.expiresAt])).toString("base64url");
    expect(await verifySession(`${forgedPayload}.${signature}`, "webhook-secret", NOW)).toBeNull();
    expect(await verifySession(`${payload}.${signature!.slice(1)}A`, "webhook-secret", NOW)).toBeNull();
    expect(await verifySession(token, "other-secret", NOW)).toBeNull();
    expect(await verifySession(`${token}.extra`, "webhook-secret", NOW)).toBeNull();
    expect(await verifySession(null, "webhook-secret", NOW)).toBeNull();
  });
});

describe("game links", () => {
  it("encode the group and room in characters Telegram allows", () => {
    const param = webStartParam(-1001234567890, 42);
    expect(param).toBe("g1001234567890r42");
    expect(param).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(parseStartParam(param)).toEqual({ chatId: -1001234567890, roomId: 42 });
    expect(parseStartParam(webStartParam(-4567, 1))).toEqual({ chatId: -4567, roomId: 1 });
  });

  it("reject anything else", () => {
    for (const junk of [null, undefined, "", "g0r1", "g123r0", "g123", "r5", "g-123r5", "g123r5x", "g99999999999999999999r1"]) {
      expect(parseStartParam(junk)).toBeNull();
    }
  });
});
