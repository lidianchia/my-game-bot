import type { Update } from "grammy/types";

/**
 * Which Durable Object an update belongs to. Each group gets its own object
 * (keyed by chat id), which serializes everything that happens in that group.
 *
 * Private chats are usually routed to the user's own object, with two
 * exceptions that point back at a group, for games that talk to players in DM:
 *   - deep links: `/start g<groupChatId>` (opened from a button in the group)
 *   - DM buttons whose payload starts with `g<groupChatId>~`
 */
export function routeChatId(update: Update): number | null {
  const query = update.callback_query;
  if (query) {
    const groupInPayload = query.data ? /^g(-?\d+)~/.exec(query.data) : null;
    if (groupInPayload) return Number(groupInPayload[1]);
    return query.message?.chat.id ?? null;
  }

  if (update.my_chat_member) return update.my_chat_member.chat.id;

  const message = update.message;
  if (!message) return null;
  if (message.chat.type === "private") {
    const deepLink = /^\/start(?:@\w+)?\s+g(-?\d+)\s*$/.exec(message.text ?? "");
    if (deepLink) return Number(deepLink[1]);
  }
  return message.chat.id;
}

/** Wraps a payload for a button sent in DM so its press is routed to the group's object. */
export function groupScopedCallback(groupChatId: number, data: string): string {
  return `g${groupChatId}~${data}`;
}

export function stripGroupScope(data: string): string {
  return data.replace(/^g-?\d+~/, "");
}
