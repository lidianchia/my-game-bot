/**
 * The bot's entire icon vocabulary.
 *
 * Every glyph here is a plain Unicode symbol, not an emoji (no Emoji or
 * Extended_Pictographic property), so Telegram draws it in the text colour like
 * an icon on every client and theme, instead of swapping in a colourful emoji
 * image. Custom emoji would look nicer still, but Telegram only lets a bot use
 * them when its owner has Premium. Keep this set tiny; one meaning per glyph.
 */
export const G = {
  host: "♛",
  check: "✓",
  cross: "✗",
  arrow: "→",
  dot: "·",
  reroll: "↻",
} as const;

/** Heat level as filled/empty dots: ●○○, ●●○, ●●●. */
export function heat(level: 1 | 2 | 3): string {
  return "●".repeat(level) + "○".repeat(3 - level);
}

/** +2, −1, 0 with a real minus sign, which sits better next to digits than a hyphen. */
export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}
