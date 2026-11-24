import type { ChatMemberStatus, Keyboard, SendOptions, TelegramPort } from "../../src/telegram/port";

export interface FakeMessage {
  id: number;
  chatId: number;
  text: string;
  keyboard: Keyboard;
  threadId: number | null;
  replyTo?: number;
  edits: number;
}

const ALLOWED_TAGS = new Set(["b", "i", "u", "s", "a", "code", "pre", "blockquote"]);

/**
 * Rejects what the real Bot API rejects ("can't parse entities"), so a
 * rendering bug fails the test instead of failing in someone's group chat.
 */
export function assertTelegramHtml(html: string): void {
  if (html.length > 4096) throw new Error(`message too long (${html.length})`);
  const stack: string[] = [];
  for (const match of html.matchAll(/<(\/?)([a-z]+)([^>]*)>/g)) {
    const [, closing, tag] = match;
    if (!ALLOWED_TAGS.has(tag!)) throw new Error(`unsupported tag <${tag}> in: ${html}`);
    if (closing) {
      if (stack.pop() !== tag) throw new Error(`unbalanced </${tag}> in: ${html}`);
    } else {
      stack.push(tag!);
    }
  }
  if (stack.length) throw new Error(`unclosed <${stack.join(">, <")}> in: ${html}`);
  const withoutTags = html.replace(/<\/?[a-z]+[^>]*>/g, "");
  if (/[<>]/.test(withoutTags)) throw new Error(`stray < or > in: ${html}`);
  if (/&(?!amp;|lt;|gt;|quot;|#\d+;)/.test(withoutTags)) throw new Error(`unescaped & in: ${html}`);
}

function assertKeyboard(keyboard: Keyboard | undefined): void {
  for (const row of keyboard ?? []) {
    for (const key of row) {
      if ("callback_data" in key && key.callback_data !== undefined) {
        const bytes = new TextEncoder().encode(key.callback_data).length;
        if (bytes > 64 || bytes === 0) throw new Error(`bad callback_data (${bytes} bytes): ${key.callback_data}`);
      }
      if (!key.text) throw new Error("button without text");
      const style = (key as { style?: string }).style;
      if (style !== undefined && !["primary", "success", "danger"].includes(style)) throw new Error(`bad button style ${style}`);
    }
  }
}

export class FakeTelegram implements TelegramPort {
  readonly messages = new Map<number, FakeMessage>();
  readonly direct: Array<{ userId: number; text: string; keyboard?: Keyboard }> = [];
  readonly answers: Array<{ id: string; text?: string; alert?: boolean }> = [];
  readonly pinned = new Set<number>();
  readonly admins = new Set<number>();
  /** People who aren't (or are no longer) members of the group. */
  readonly outsiders = new Set<number>();
  readonly dmBlocked = new Set<number>();
  readonly deleted = new Set<number>();
  canPin = true;
  leftChat = false;
  botUsername = "TestGameBot";
  getMeCalls = 0;
  private nextId = 1000;

  async sendMessage(chatId: number, html: string, options: SendOptions = {}): Promise<number> {
    assertTelegramHtml(html);
    assertKeyboard(options.keyboard);
    const id = this.nextId++;
    this.messages.set(id, {
      id,
      chatId,
      text: html,
      keyboard: options.keyboard ?? [],
      threadId: options.threadId ?? null,
      replyTo: options.replyTo,
      edits: 0,
    });
    return id;
  }

  async sendDirect(userId: number, html: string, keyboard?: Keyboard): Promise<number | null> {
    assertTelegramHtml(html);
    assertKeyboard(keyboard);
    if (this.dmBlocked.has(userId)) return null;
    this.direct.push({ userId, text: html, keyboard });
    return this.nextId++;
  }

  async editMessage(_chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<boolean> {
    assertTelegramHtml(html);
    assertKeyboard(keyboard);
    const message = this.messages.get(messageId);
    if (!message || this.deleted.has(messageId)) return false;
    message.text = html;
    message.keyboard = keyboard ?? [];
    message.edits += 1;
    return true;
  }

  async answerCallback(id: string, text?: string, alert?: boolean): Promise<void> {
    if (text && text.length > 200) throw new Error(`callback answer too long: ${text}`);
    if (text && /<[a-z]/.test(text)) throw new Error(`callback answers are plain text, got HTML: ${text}`);
    this.answers.push({ id, text, alert });
  }

  async pinMessage(_chatId: number, messageId: number): Promise<boolean> {
    if (!this.canPin) return false;
    this.pinned.add(messageId);
    return true;
  }

  async unpinMessage(_chatId: number, messageId: number): Promise<void> {
    this.pinned.delete(messageId);
  }

  async getChatMemberStatus(_chatId: number, userId: number): Promise<ChatMemberStatus | null> {
    if (this.outsiders.has(userId)) return "left";
    return this.admins.has(userId) ? "administrator" : "member";
  }

  async getBotUsername(): Promise<string> {
    this.getMeCalls += 1;
    return this.botUsername;
  }

  async leaveChat(): Promise<void> {
    this.leftChat = true;
  }

  // ------------------------------------------------------------ inspection

  message(id: number | null | undefined): FakeMessage {
    const message = id == null ? undefined : this.messages.get(id);
    if (!message) throw new Error(`no message ${id}`);
    return message;
  }

  last(): FakeMessage {
    return [...this.messages.values()].at(-1)!;
  }

  /** Newest message whose text contains `needle`. */
  find(needle: string): FakeMessage | undefined {
    return [...this.messages.values()].reverse().find((message) => message.text.includes(needle));
  }

  /** Newest message that carries a button whose label contains `label`. */
  findWithButton(label: string): FakeMessage | undefined {
    return [...this.messages.values()]
      .reverse()
      .find((message) => message.keyboard.flat().some((key) => key.text.includes(label)));
  }

  labels(id: number | null | undefined): string[] {
    return this.message(id).keyboard.flat().map((key) => key.text);
  }

  /** Callback data of the first button on a message whose label contains `label`. */
  buttonData(id: number | null | undefined, label: string): string {
    const key = this.message(id)
      .keyboard.flat()
      .find((candidate) => candidate.text.includes(label));
    if (!key || !("callback_data" in key) || !key.callback_data) {
      throw new Error(`no button "${label}" on message ${id}; have: ${this.labels(id).join(" | ")}`);
    }
    return key.callback_data;
  }

  lastAnswer(): { text?: string; alert?: boolean } | undefined {
    return this.answers.at(-1);
  }
}
