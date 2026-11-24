import type { GameModule } from "../core/game";
import { guessGame } from "./guess";
import { truthOrDare } from "./tod";

/**
 * Every playable game. The first one is what a bare /play opens; others are
 * started with /play <id>. A new game is a new GameModule added here.
 */
export const GAMES: GameModule[] = [truthOrDare, guessGame];
