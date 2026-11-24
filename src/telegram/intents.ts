import type { Message, MessageEntity, Update, User } from "grammy/types";

/** The slice of a Telegram user the bot cares about. */
export interface TgUser {
  id: number;
  isBot: boolean;
  firstName: string;
  lastName?: string;
  username?: string;
}

/** Someone named in a command: either a resolved user or just an @username. */
export type MentionRef = { kind: "user"; user: TgUser } | { kind: "username"; username: string };

export type ChatKind = "private" | "group";

/**
 * A Telegram update reduced to what the bot acts on. Parsing happens once,
 * up front, so the handlers never touch raw Bot API shapes.
 */
export type Intent =
  | {
      type: "command";
      command: string;
      args: string;
      from: TgUser;
      chatKind: ChatKind;
      messageId: number;
      threadId: number | null;
      replyToUser: TgUser | null;
      mentions: MentionRef[];
    }
  | {
      type: "callback";
      callbackId: string;
      data: string;
      from: TgUser;
      chatKind: ChatKind;
      messageId: number | null;
    }
  | { type: "members-joined"; users: TgUser[]; from: TgUser | null }
  | { type: "bot-added"; from: TgUser | null }
  | { type: "migrated"; toChatId: number }
  | { type: "noop"; from: TgUser | null };

export function toTgUser(user: User): TgUser {
  return {
    id: user.id,
    isBot: user.is_bot,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
  };
}

function chatKindOf(type: string): ChatKind {
  return type === "private" ? "private" : "group";
}

/** Forum topics need replies posted back into the same topic. */
function threadIdOf(message: Message): number | null {
  return message.is_topic_message && message.message_thread_id ? message.message_thread_id : null;
}

/**
 * @param botUsername Our own username (without @). Commands addressed to a
 *   different bot, like `/play@OtherBot`, are ignored.
 */
export function parseUpdate(update: Update, botUsername: string | null): Intent {
  if (update.callback_query) {
    const query = update.callback_query;
    return {
      type: "callback",
      callbackId: query.id,
      data: query.data ?? "",
      from: toTgUser(query.from),
      chatKind: chatKindOf(query.message?.chat.type ?? "private"),
      messageId: query.message?.message_id ?? null,
    };
  }

  if (update.my_chat_member) {
    const change = update.my_chat_member;
    const nowIn = ["member", "administrator"].includes(change.new_chat_member.status);
    const wasIn = ["member", "administrator", "creator"].includes(change.old_chat_member.status);
    if (nowIn && !wasIn && change.chat.type !== "private") {
      return { type: "bot-added", from: toTgUser(change.from) };
    }
    return { type: "noop", from: null };
  }

  const message = update.message;
  if (!message) return { type: "noop", from: null };
  const from = message.from ? toTgUser(message.from) : null;

  if (message.migrate_to_chat_id) {
    return { type: "migrated", toChatId: message.migrate_to_chat_id };
  }
  if (message.new_chat_members?.length) {
    return { type: "members-joined", users: message.new_chat_members.map(toTgUser), from };
  }

  const text = message.text ?? "";
  const entities = message.entities ?? [];
  const commandEntity = entities.find((entity) => entity.type === "bot_command" && entity.offset === 0);
  if (!commandEntity || !from) return { type: "noop", from };

  const rawCommand = text.slice(1, commandEntity.length); // drop the leading "/"
  const [name = "", target] = rawCommand.split("@");
  if (target && botUsername && target.toLowerCase() !== botUsername.toLowerCase()) {
    return { type: "noop", from };
  }

  return {
    type: "command",
    command: name.toLowerCase(),
    args: text.slice(commandEntity.length).trim(),
    from,
    chatKind: chatKindOf(message.chat.type),
    messageId: message.message_id,
    threadId: threadIdOf(message),
    replyToUser: message.reply_to_message?.from ? toTgUser(message.reply_to_message.from) : null,
    mentions: extractMentions(text, entities),
  };
}

function extractMentions(text: string, entities: MessageEntity[]): MentionRef[] {
  const mentions: MentionRef[] = [];
  for (const entity of entities) {
    if (entity.type === "mention") {
      // Entity offsets are UTF-16 code units, which is exactly what String.slice uses.
      const username = text.slice(entity.offset + 1, entity.offset + entity.length);
      if (username) mentions.push({ kind: "username", username });
    } else if (entity.type === "text_mention") {
      mentions.push({ kind: "user", user: toTgUser(entity.user) });
    }
  }
  return mentions;
}

/** Every user an update reveals, so the bot can offer them in the invite list later. */
export function usersSeenIn(update: Update): TgUser[] {
  const seen: User[] = [];
  const message = update.message;
  if (message?.from) seen.push(message.from);
  if (message?.reply_to_message?.from) seen.push(message.reply_to_message.from);
  for (const user of message?.new_chat_members ?? []) seen.push(user);
  for (const entity of message?.entities ?? []) {
    if (entity.type === "text_mention") seen.push(entity.user);
  }
  if (update.callback_query) seen.push(update.callback_query.from);
  return seen.filter((user) => !user.is_bot).map(toTgUser);
}
