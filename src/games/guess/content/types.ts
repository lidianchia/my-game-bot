/** One language's side of a word card. */
export interface WordSide {
  /** The word to describe or guess. */
  word: string;
  /** Off-limits words for the describer (the most obvious ways to describe it). Exactly four. */
  taboo: string[];
  /** Other answers that also count as correct (common synonyms). Plurals are handled by normalisation. */
  alt?: string[];
}

/** A word in both languages; a room uses the side matching its language. */
export interface WordCard {
  id: string;
  zh: WordSide;
  en: WordSide;
}
