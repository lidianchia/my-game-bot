/** 1 = 😇 mild, 2 = 😏 spicy, 3 = 🌶️ 18+ */
export type Level = 1 | 2 | 3;

/**
 * How a dare is performed. The group plays remotely in a voice chat with no
 * video, so every dare must be doable by voice, by posting in the group, or by
 * messaging someone outside the group.
 */
export type DareType = "voice" | "post" | "contact";

export interface Card {
  id: string;
  level: Level;
  /** Only dares and penalties have a type. */
  type?: DareType;
  zh: string;
  en: string;
}
