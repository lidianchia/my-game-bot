import { describe, expect, it } from "vitest";
import { stringsFor } from "../../public/app/i18n.js";
import { coreMessages, type Lang } from "../../src/core/i18n";
import { guessMessages } from "../../src/games/guess/i18n";
import { todMessages } from "../../src/games/tod/i18n";
import { G, heat, signed } from "../../src/ui/glyphs";
import { alice, bob, carol, createHarness, personById, roomWith } from "../helpers/harness";

/**
 * The bot speaks without emoji: Telegram swaps emoji for colourful images
 * whose look depends on each phone, and the group found them ugly. Icons come
 * from ui/glyphs.ts (monochrome symbols drawn in the text colour) and colour
 * from button styles. These tests keep emoji from creeping back in.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Every string a message table can produce: plain values, nested records, and functions called with dummy args. */
function allStrings(table: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(table)) {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") out.push(String((value as (...args: unknown[]) => unknown)(1, 2, 3, 4, 5, 6, 7, 8)));
    else if (value && typeof value === "object") out.push(...allStrings(value as Record<string, unknown>));
  }
  return out;
}

describe("visual style", () => {
  it("uses only non-emoji glyphs as icons", () => {
    for (const glyph of [...Object.values(G), heat(1), heat(3), signed(-2)]) {
      expect(PICTOGRAPHIC.test(glyph), glyph).toBe(false);
      expect(/\p{Emoji_Presentation}/u.test(glyph), glyph).toBe(false);
    }
  });

  it("keeps every interface string emoji-free in both languages", () => {
    for (const lang of ["zh", "en"] as Lang[]) {
      const tables = [coreMessages[lang], todMessages[lang], guessMessages[lang], stringsFor(lang)];
      for (const text of tables.flatMap((table) => allStrings(table as Record<string, unknown>))) {
        expect(PICTOGRAPHIC.test(text), `${lang}: ${text}`).toBe(false);
      }
    }
  });

  it("renders a whole game without a single emoji outside the questions themselves", async () => {
    for (const lang of ["zh", "en"] as Lang[]) {
      const h = createHarness({ lang, seed: 21 });
      await roomWith(h, [bob, carol]);
      const labels = lang === "zh"
        ? { dare: "大冒险", truth: "真心话", done: "做完了", yes: "过 ·", no: "不过", chicken: "怂了", next: "下一轮" }
        : { dare: "Dare", truth: "Truth", done: "Done", yes: "Pass", no: "Fail", chicken: "Chicken", next: "Next" };
      const voters = () => [alice, bob, carol].filter((person) => person.id !== h.turn().playerId);

      await h.press(personById(h.turn().playerId), h.turnCard().id, labels.dare);
      await h.press(personById(h.turn().playerId), h.turnCard().id, labels.done);
      for (const voter of voters()) await h.press(voter, h.turnCard().id, labels.no);
      await h.press(personById(h.turn().playerId), h.turnCard().id, labels.done);
      for (const voter of voters()) await h.press(voter, h.turnCard().id, labels.yes);
      await h.press(alice, h.turnCard().id, labels.next);
      await h.press(personById(h.turn().playerId), h.turnCard().id, labels.truth);
      await h.press(personById(h.turn().playerId), h.turnCard().id, labels.chicken);
      await h.command(alice, "/end");
      await h.command(alice, "/log");
      await h.command(alice, "/stats");

      for (const message of h.tg.messages.values()) {
        // Question and penalty texts are content (a dare may literally say "send a ❤️"), so they're exempt.
        const chrome = message.text.replace(/<blockquote>[\s\S]*?<\/blockquote>/g, "").replace(/<i>[\s\S]*?<\/i>/g, "");
        expect(PICTOGRAPHIC.test(chrome), `${lang}: ${chrome}`).toBe(false);
        for (const label of message.keyboard.flat().map((key) => key.text)) {
          expect(PICTOGRAPHIC.test(label), `${lang} button: ${label}`).toBe(false);
        }
      }
      for (const answer of h.tg.answers) expect(PICTOGRAPHIC.test(answer.text ?? ""), `${lang} toast: ${answer.text}`).toBe(false);
    }
  });

  it("colours buttons by meaning", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const card = h.turnCard();
    const style = (label: string) =>
      (card.keyboard.flat().find((key) => key.text.includes(label)) as { style?: string } | undefined)?.style;
    expect(style("真心话")).toBe("primary");
    expect(style("大冒险")).toBe("danger");
    const room = h.roomMessage().keyboard.flat() as Array<{ text: string; style?: string }>;
    expect(room.find((key) => key.text === "结束")?.style).toBe("danger");
    expect(room.find((key) => key.text === "申请加入")?.style).toBe("primary");
  });
});
