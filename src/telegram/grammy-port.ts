// The web build is what Workers runs; importing it explicitly keeps tests on the same code.
import { Api, GrammyError, type Transformer } from "grammy/web";
import type { ChatMemberStatus, Keyboard, SendOptions, TelegramPort } from "./port";

const MAX_FLOOD_WAIT_SECONDS = 15;

/**
 * Telegram answers 429 with `retry_after` when a group gets too many bot
 * messages at once (a burst of votes can do it). Wait it out a couple of times
 * rather than dropping the edit.
 */
const retryFloodLimits: Transformer = async (prev, method, payload, signal) => {
  for (let attempt = 0; ; attempt++) {
    const response = await prev(method, payload, signal);
    const wait = response.ok ? undefined : response.parameters?.retry_after;
    if (wait === undefined || attempt >= 2 || wait > MAX_FLOOD_WAIT_SECONDS) return response;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
};

/** grammY-backed implementation of {@link TelegramPort}. */
export function createTelegramPort(token: string, apiRoot?: string): TelegramPort {
  // A short timeout keeps one stuck request from stalling the chat's update queue.
  const api = new Api(token, { apiRoot: apiRoot || undefined, timeoutSeconds: 15 });
  api.config.use(retryFloodLimits);
  let cachedUsername: string | null = null;

  return {
    async sendMessage(chatId: number, html: string, options: SendOptions = {}): Promise<number> {
      const message = await api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
        message_thread_id: options.threadId ?? undefined,
        reply_parameters: options.replyTo
          ? { message_id: options.replyTo, allow_sending_without_reply: true }
          : undefined,
        disable_notification: options.silent,
      });
      return message.message_id;
    },

    async sendDirect(userId: number, html: string, keyboard?: Keyboard): Promise<number | null> {
      try {
        const message = await api.sendMessage(userId, html, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
        });
        return message.message_id;
      } catch (error) {
        // 403: the user never pressed Start in a private chat with the bot, or blocked it.
        if (error instanceof GrammyError && error.error_code === 403) return null;
        throw error;
      }
    },

    async editMessage(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<boolean> {
      try {
        await api.editMessageText(chatId, messageId, html, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: keyboard ?? [] },
        });
        return true;
      } catch (error) {
        if (!(error instanceof GrammyError)) throw error;
        // Re-rendering an unchanged view is routine (e.g. a vote toggled back); not an error.
        if (error.description.includes("message is not modified")) return true;
        if (/message to edit not found|MESSAGE_ID_INVALID/i.test(error.description)) return false;
        throw error;
      }
    },

    async answerCallback(callbackId: string, text?: string, alert?: boolean): Promise<void> {
      try {
        await api.answerCallbackQuery(callbackId, { text, show_alert: alert });
      } catch (error) {
        // A query answered too late (e.g. queued behind a slow AI call) is harmless.
        if (error instanceof GrammyError && error.error_code === 400) return;
        throw error;
      }
    },

    async pinMessage(chatId: number, messageId: number): Promise<boolean> {
      try {
        await api.pinChatMessage(chatId, messageId, { disable_notification: true });
        return true;
      } catch (error) {
        if (error instanceof GrammyError) return false; // not an admin, or pinning disabled
        throw error;
      }
    },

    async unpinMessage(chatId: number, messageId: number): Promise<void> {
      try {
        await api.unpinChatMessage(chatId, messageId);
      } catch (error) {
        if (error instanceof GrammyError) return;
        throw error;
      }
    },

    async getChatMemberStatus(chatId: number, userId: number): Promise<ChatMemberStatus | null> {
      try {
        const member = await api.getChatMember(chatId, userId);
        return member.status;
      } catch (error) {
        if (error instanceof GrammyError) return null;
        throw error;
      }
    },

    async getBotUsername(): Promise<string> {
      if (!cachedUsername) cachedUsername = (await api.getMe()).username;
      return cachedUsername;
    },

    async leaveChat(chatId: number): Promise<void> {
      await api.leaveChat(chatId);
    },
  };
}
