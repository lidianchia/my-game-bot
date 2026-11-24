import type { ChatDurableObject } from "./chat-object";

export interface Env {
  CHAT: DurableObjectNamespace<ChatDurableObject>;
  /** Secret: token from @BotFather. */
  BOT_TOKEN: string;
  /** Secret: echoed by Telegram in X-Telegram-Bot-Api-Secret-Token; also guards /setup. */
  WEBHOOK_SECRET: string;
  /** Secret: Claude writes the AI questions when this is set. */
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  AI_PROVIDERS?: string;
  DEEPSEEK_MODEL?: string;
  GEMINI_MODEL?: string;
  ALLOWED_CHAT_IDS?: string;
  DEFAULT_LANG?: string;
  /** Short name of the Mini App created with /newapp in BotFather (t.me/<bot>/<short name>). */
  MINIAPP_SHORT_NAME?: string;
  /** Tests point this at a fake Bot API server. */
  TELEGRAM_API_ROOT?: string;
}
