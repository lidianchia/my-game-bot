import type { Lang } from "../../core/i18n";
import { CARDS } from "./content/cards";
import type { WordCard } from "./content/types";
import type { DrawnCard } from "./types";

/** A random card not used yet in this room; once the deck runs out it starts over. */
export function drawCard(lang: Lang, used: ReadonlySet<string>, random: () => number, deck: readonly WordCard[] = CARDS): DrawnCard {
  const fresh = deck.filter((card) => !used.has(card.id));
  const pool = fresh.length ? fresh : deck;
  const card = pool[Math.floor(random() * pool.length)]!;
  const side = card[lang];
  return { id: card.id, word: side.word, taboo: [...side.taboo], alt: [...(side.alt ?? [])] };
}
