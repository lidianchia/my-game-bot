/** Escapes text for Telegram's HTML parse mode. Every dynamic string must pass through here. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A clickable name that pings the user when it appears in a *new* message
 * (edits never notify), so use it where a ping is wanted and plain names elsewhere.
 */
export function mentionHtml(userId: number, name: string): string {
  return `<a href="tg://user?id=${userId}">${esc(name)}</a>`;
}

/** Telegram rejects messages over 4096 characters; split on line boundaries below that. */
export function splitForTelegram(text: string, limit = 3800): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
