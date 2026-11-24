import type { InlineKeyboardButton } from "grammy/types";

export type Keyboard = InlineKeyboardButton[][];

export interface SendOptions {
  keyboard?: Keyboard;
  /** Forum topic to post into; omitted for ordinary groups. */
  threadId?: number | null;
  replyTo?: number;
  silent?: boolean;
}

export type ChatMemberStatus = "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";

/**
 * Every Telegram call the bot makes goes through this interface. Production
 * backs it with grammY's Api client; tests back it with an in-memory fake, so
 * game flows can be exercised end to end without a network.
 */
export interface TelegramPort {
  sendMessage(chatId: number, html: string, options?: SendOptions): Promise<number>;
  /**
   * Private message to a user. Resolves to null when the user never opened a
   * chat with the bot (Telegram forbids bots from messaging first).
   */
  sendDirect(userId: number, html: string, keyboard?: Keyboard): Promise<number | null>;
  /**
   * Replaces text and keyboard; passing no keyboard removes the buttons.
   * Resolves to false when the message no longer exists (someone deleted it).
   */
  editMessage(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<boolean>;
  answerCallback(callbackId: string, text?: string, alert?: boolean): Promise<void>;
  /** Returns false when the bot lacks pin rights; pinning is a nice-to-have. */
  pinMessage(chatId: number, messageId: number): Promise<boolean>;
  unpinMessage(chatId: number, messageId: number): Promise<void>;
  getChatMemberStatus(chatId: number, userId: number): Promise<ChatMemberStatus | null>;
  getBotUsername(): Promise<string>;
  leaveChat(chatId: number): Promise<void>;
}

/**
 * Telegram's coloured buttons: green for go/confirm, red for destructive or
 * negative, blue for the main action and for the selected option in a group.
 * Clients that predate button styles simply show their default look.
 */
export type ButtonStyle = "success" | "danger" | "primary";

export function button(text: string, callbackData: string, style?: ButtonStyle): InlineKeyboardButton {
  return style ? { text, callback_data: callbackData, style } : { text, callback_data: callbackData };
}

export function urlButton(text: string, url: string): InlineKeyboardButton {
  return { text, url };
}
