import type { BotCommand } from "grammy/types";
import type { GameModule } from "./game";
import { coreMessages, type Lang } from "./i18n";

/**
 * Game commands come from the list of games, so a new game shows up in the
 * command menu, /help and the welcome message without touching any of them.
 */

/** The command that opens a game: the first game is /play, every other one is its id (/guess). */
export function gameCommand(games: readonly GameModule[], game: GameModule): string {
  return games[0] === game ? "play" : game.id;
}

export function blurbOf(game: GameModule, lang: Lang): string {
  return game.blurb?.(lang) ?? game.title(lang);
}

/** The bot's command menu in one language (published by /setup). */
export function commandMenu(games: readonly GameModule[], lang: Lang): BotCommand[] {
  const m = coreMessages[lang];
  return [
    ...games.map((game) => ({ command: gameCommand(games, game), description: m.menuGame(blurbOf(game, lang)) })),
    ...m.menu,
  ];
}
