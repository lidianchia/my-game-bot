/**
 * The `startapp` payload of a game link (t.me/<bot>/<app>?startapp=...). Telegram
 * returns it inside the signed initData, so after verification it reliably says
 * which group and room the page was opened for. Allowed characters are only
 * A-Z a-z 0-9 _ -, hence `g<group id without its minus sign>r<room id>`.
 */
export function webStartParam(chatId: number, roomId: number): string {
  return `g${Math.abs(chatId)}r${roomId}`;
}

export function parseStartParam(value: string | null | undefined): { chatId: number; roomId: number } | null {
  const match = /^g([1-9]\d{0,17})r([1-9]\d{0,11})$/.exec(value ?? "");
  if (!match) return null;
  const chatId = -Number(match[1]);
  const roomId = Number(match[2]);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(roomId)) return null;
  return { chatId, roomId };
}
