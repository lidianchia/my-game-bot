import type { DrawnCard } from "./types";

/**
 * Deciding what counts as "the same word". Chinese is compared character by
 * character with spaces and punctuation ignored; English word by word,
 * ignoring case, punctuation and plural endings ("Apples!" = "apple").
 */

const HAN = /\p{Script=Han}/u;

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** Letters and digits only: "火 车。" -> "火车", "Ice-Cream" -> "icecream". */
export function squash(text: string): string {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokens(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A word and the forms it may have before a plural ending: "horses" -> horses, horse, hors. */
function forms(token: string): string[] {
  const out = [token];
  if (!/^[a-z]+$/.test(token) || token.length <= 3) return out;
  if (token.endsWith("ies")) out.push(`${token.slice(0, -3)}y`);
  if (token.endsWith("es")) out.push(token.slice(0, -2));
  if (token.endsWith("s") && !token.endsWith("ss")) out.push(token.slice(0, -1));
  return out;
}

function sameToken(a: string, b: string): boolean {
  const formsOfB = forms(b);
  return forms(a).some((form) => formsOfB.includes(form));
}

/** Whether two answers are the same word. */
export function sameWord(a: string, b: string): boolean {
  const squashedA = squash(a);
  if (!squashedA) return false;
  if (squashedA === squash(b)) return true;
  if (HAN.test(a) || HAN.test(b)) return false;
  const tokensA = tokens(a);
  const tokensB = tokens(b);
  return tokensA.length === tokensB.length && tokensA.every((token, index) => sameToken(token, tokensB[index]!));
}

/** Whether `text` contains `term`: as characters for Chinese, as whole words for English. */
export function containsTerm(text: string, term: string): boolean {
  const squashedTerm = squash(term);
  if (!squashedTerm) return false;
  if (HAN.test(term)) return squash(text).includes(squashedTerm);
  const words = tokens(text);
  const wanted = tokens(term);
  for (let start = 0; start + wanted.length <= words.length; start++) {
    if (wanted.every((token, offset) => sameToken(words[start + offset]!, token))) return true;
  }
  // "icecream" typed as one word still contains "ice cream".
  return wanted.length > 1 && squash(text).includes(squashedTerm);
}

/** Whether a guess names the card's word (or an accepted alternative). */
export function isAnswer(guess: string, card: DrawnCard): boolean {
  return [card.word, ...card.alt].some((answer) => sameWord(guess, answer));
}

/** The first word or off-limits word a describer's typed hint gives away, if any. */
export function bannedTermIn(hint: string, card: DrawnCard): string | null {
  return [card.word, ...card.alt, ...card.taboo].find((term) => containsTerm(hint, term)) ?? null;
}

/** A clue that is the answer, contains it, or is part of it (火 for 火车) gives it away. */
export function revealsAnswer(clue: string, card: DrawnCard): boolean {
  return [card.word, ...card.alt].some(
    (answer) => sameWord(clue, answer) || containsTerm(clue, answer) || containsTerm(answer, clue),
  );
}

/**
 * Clues removed before the review: anything giving the answer away, and every
 * clue that matches another one (both go, that's the point of the mode).
 */
export function autoRemovals(clues: Record<string, string>, card: DrawnCard): Record<string, "duplicate" | "answer"> {
  const removed: Record<string, "duplicate" | "answer"> = {};
  const entries = Object.entries(clues);
  for (const [writer, clue] of entries) if (revealsAnswer(clue, card)) removed[writer] = "answer";
  const rest = entries.filter(([writer]) => !removed[writer]);
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const [writerA, clueA] = rest[i]!;
      const [writerB, clueB] = rest[j]!;
      if (sameWord(clueA, clueB)) {
        removed[writerA] = "duplicate";
        removed[writerB] = "duplicate";
      }
    }
  }
  return removed;
}

/** Trims and collapses whitespace, drops control characters, and caps the length. */
export function cleanInput(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, maxChars).join("");
}
