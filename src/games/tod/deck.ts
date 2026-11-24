import { DARES } from "./content/dares";
import { PENALTIES } from "./content/penalties";
import { TRUTHS } from "./content/truths";
import type { Card, DareType, Level } from "./content/types";
import type { QuestionKind } from "./types";

const POOLS: Record<QuestionKind, Card[]> = { truth: TRUTHS, dare: DARES, penalty: PENALTIES };

/** Voice performances come up about half as often as other dares; the group asked for fewer. */
const TYPE_WEIGHT: Record<DareType, number> = { voice: 0.5, post: 1, contact: 1 };

/**
 * The chosen level dominates, with the level below mixed in (1 in 4 draws)
 * so a long night at one level doesn't burn through its cards too fast.
 */
function levelWeight(card: Card, level: Level): number {
  if (card.level === level) return 3;
  if (card.level === level - 1) return 1;
  return 0;
}

export interface DrawOptions {
  level: Level;
  dareTypes: DareType[];
  /** Card ids already used in this room; avoided until the pool runs dry. */
  used: ReadonlySet<string>;
  random: () => number;
}

export function drawCard(kind: QuestionKind, options: DrawOptions): Card {
  const pool = POOLS[kind];
  const typed = kind === "truth" ? pool : pool.filter((card) => card.type && options.dareTypes.includes(card.type));
  const candidates = (typed.length ? typed : pool).filter((card) => levelWeight(card, options.level) > 0);
  const fresh = candidates.filter((card) => !options.used.has(card.id));
  // Once every matching card has been used, repeats are better than no question at all.
  const choices = fresh.length ? fresh : candidates.length ? candidates : pool;

  const weightOf = (card: Card) =>
    Math.max(levelWeight(card, options.level), 1) * (card.type ? TYPE_WEIGHT[card.type] : 1);
  const total = choices.reduce((sum, card) => sum + weightOf(card), 0);
  let roll = options.random() * total;
  for (const card of choices) {
    roll -= weightOf(card);
    if (roll < 0) return card;
  }
  return choices[choices.length - 1]!;
}

export function allCards(): Card[] {
  return [...TRUTHS, ...DARES, ...PENALTIES];
}
