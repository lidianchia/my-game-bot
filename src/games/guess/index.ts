import type { GameModule, SettingsResult, WebAction } from "../../core/game";
import type { Lang } from "../../core/i18n";
import { settingCallback } from "../../telegram/callback";
import { button, type Keyboard } from "../../telegram/port";
import { G } from "../../ui/glyphs";
import type { WebSetting } from "../../web/protocol";
import { drawCard } from "./deck";
import { guessMessages } from "./i18n";
import { autoRemovals, bannedTermIn, cleanInput, isAnswer } from "./normalize";
import { renderBoard, renderLog, renderStats, renderSummary, type GuessContext } from "./render";
import { missingClues, nextLead, survivingWriters, toRecord } from "./rules";
import {
  LIMITS,
  MODE_SETTINGS,
  POINTS,
  ROUNDS_CHOICES,
  SECONDS_CHOICES,
  TIMING,
  TURN_LOG_KIND,
  type DrawnCard,
  type FeedItem,
  type GuessSettings,
  type GuessState,
  type GuessTurn,
  type Mode,
  type ModeSetting,
  type SkipReason,
  type TabooOutcome,
  type TabooTurn,
  type UniqueOutcome,
  type UniqueTurn,
} from "./types";
import { guessView } from "./view";

/** Deadline kinds: the current phase's time limit, and the pause after the last turn before the game closes. */
const PHASE = "phase";
const WRAP_UP = "wrapup";

const msgs = (game: GuessContext) => guessMessages[game.lang];

// --------------------------------------------------------------- helpers

function draw(game: GuessContext): DrawnCard {
  const state = game.room.state!;
  const card = drawCard(game.lang, new Set(state.usedCards), () => game.random());
  state.usedCards.push(card.id);
  return card;
}

function modeOfTurn(setting: ModeSetting, turnNo: number): Mode {
  if (setting !== "mix") return setting;
  return turnNo % 2 === 1 ? "taboo" : "unique";
}

/** Points count on the scoreboard straight away, not only when the turn ends. */
function award(game: GuessContext, turn: GuessTurn, userId: number, points: number): void {
  const state = game.room.state!;
  turn.points[userId] = (turn.points[userId] ?? 0) + points;
  state.scores[userId] = (state.scores[userId] ?? 0) + points;
}

function scheduleTimeout(game: GuessContext, turn: GuessTurn): void {
  game.cancelSchedule(PHASE);
  if (turn.endsAt !== null) game.schedule(PHASE, turn.endsAt, { turn: turn.no, phase: turn.phase });
}

function noTurnsLeft(game: GuessContext): boolean {
  return nextLead(game.room.state!, game.players(), game.room.settings.rounds) === null;
}

/** Writes the finished turn to the log, once. Deferred until the turn is left behind so a host ruling still counts. */
function commitTurn(game: GuessContext): void {
  const turn = game.room.state?.turn;
  if (!turn || turn.phase !== "done" || turn.logged) return;
  game.log(TURN_LOG_KIND, turn.leadId, toRecord(turn, game.now()));
  turn.logged = true;
}

// -------------------------------------------------------------- turn flow

async function startTurn(game: GuessContext): Promise<void> {
  const state = game.room.state!;
  const settings = game.room.settings;
  commitTurn(game);
  game.cancelSchedule(PHASE);
  game.cancelSchedule(WRAP_UP);
  const players = game.players();
  const lead = players.length >= 2 ? nextLead(state, players, settings.rounds) : null;
  if (lead === null) {
    await game.end();
    return;
  }
  for (const id of players) if (!state.order.includes(id)) state.order.push(id);

  const now = game.now();
  state.turnNo += 1;
  state.leads[lead] = (state.leads[lead] ?? 0) + 1;
  const common = { no: state.turnNo, leadId: lead, points: {}, skipReason: null, logged: false, startedAt: now, endedAt: null };
  if (modeOfTurn(settings.mode, state.turnNo) === "taboo") {
    state.turn = { ...common, mode: "taboo", phase: "ready", endsAt: now + TIMING.readyMs, card: null, results: [], feed: [] };
  } else {
    state.turn = {
      ...common,
      mode: "unique",
      phase: "writing",
      endsAt: now + TIMING.writeMs,
      card: draw(game),
      writers: players.filter((id) => id !== lead),
      clues: {},
      auto: {},
      strikes: {},
      confirmed: [],
      guess: null,
      outcome: null,
      accepted: false,
    };
  }
  scheduleTimeout(game, state.turn);
  await game.refreshRoomMessage();
}

/** Closes the turn. After the last one, people get a minute to look at the result before the game closes itself. */
async function finishTurn(game: GuessContext, turn: GuessTurn, options: { quiet?: boolean } = {}): Promise<void> {
  turn.phase = "done";
  turn.endsAt = null;
  turn.endedAt = game.now();
  if (turn.mode === "taboo") turn.card = null;
  game.cancelSchedule(PHASE);
  if (options.quiet) return;
  if (noTurnsLeft(game)) game.schedule(WRAP_UP, game.now() + TIMING.wrapUpMs);
  await game.refreshRoomMessage();
}

/** Ends the turn early; points already won stand. */
async function abortTurn(game: GuessContext, turn: GuessTurn, reason: SkipReason, options: { quiet?: boolean } = {}): Promise<void> {
  turn.skipReason = reason;
  if (turn.mode === "taboo" && turn.card) turn.results.push({ card: turn.card, outcome: "timeout", by: null });
  await finishTurn(game, turn, options);
}

// ------------------------------------------------------------ Off-limits

function pushFeed(turn: TabooTurn, item: FeedItem): void {
  turn.feed.push(item);
  if (turn.feed.length > LIMITS.feed) turn.feed.splice(0, turn.feed.length - LIMITS.feed);
}

/** Settles the card in play and deals the next one. */
function closeCard(game: GuessContext, turn: TabooTurn, outcome: TabooOutcome, by: number | null, item: FeedItem): void {
  turn.results.push({ card: turn.card!, outcome, by });
  pushFeed(turn, item);
  turn.card = draw(game);
}

async function endDescribing(game: GuessContext, turn: TabooTurn): Promise<void> {
  if (turn.card) turn.results.push({ card: turn.card, outcome: "timeout", by: null });
  await finishTurn(game, turn);
}

async function tabooAction(game: GuessContext, turn: TabooTurn, userId: number, action: WebAction): Promise<string | null> {
  const t = msgs(game);
  const isLead = userId === turn.leadId;

  if (action.op === "begin") {
    if (!isLead) return t.describerOnly;
    if (turn.phase !== "ready") return t.staleStep;
    turn.phase = "describing";
    turn.endsAt = game.now() + game.room.settings.seconds * 1000;
    turn.card = draw(game);
    scheduleTimeout(game, turn);
    return null;
  }

  if (!["guess", "hint", "skip", "buzz"].includes(action.op)) return t.staleStep;
  const card = turn.card;
  if (turn.phase !== "describing" || !card) return t.staleStep;
  // Taps name the card they were meant for, so a late tap can't land on the next one.
  if (action.card !== turn.results.length) return t.cardGone;

  switch (action.op) {
    case "guess": {
      if (isLead) return t.describerCantGuess;
      const text = cleanInput(action.text, LIMITS.guessChars);
      if (!text) return t.emptyInput;
      if (isAnswer(text, card)) {
        award(game, turn, userId, POINTS.guessed);
        award(game, turn, turn.leadId, POINTS.described);
        closeCard(game, turn, "guessed", userId, { kind: "correct", userId, text, word: card.word });
      } else {
        pushFeed(turn, { kind: "guess", userId, text });
      }
      return null;
    }
    case "hint": {
      if (!isLead) return t.describerOnly;
      const text = cleanInput(action.text, LIMITS.hintChars);
      if (!text) return t.emptyInput;
      if (bannedTermIn(text, card)) {
        award(game, turn, userId, POINTS.foul);
        closeCard(game, turn, "slipped", userId, { kind: "slip", userId, text, word: card.word });
      } else {
        pushFeed(turn, { kind: "hint", userId, text });
      }
      return null;
    }
    case "skip":
      if (!isLead) return t.describerOnly;
      closeCard(game, turn, "skipped", null, { kind: "skip", userId, text: "", word: card.word });
      return null;
    case "buzz":
      if (isLead) return t.describerCantBuzz;
      award(game, turn, turn.leadId, POINTS.foul);
      closeCard(game, turn, "buzzed", userId, { kind: "buzz", userId, text: "", word: card.word });
      return null;
    default:
      return t.staleStep;
  }
}

// ---------------------------------------------------------- Unique Clues

async function toReview(game: GuessContext, turn: UniqueTurn): Promise<void> {
  turn.auto = autoRemovals(turn.clues, turn.card);
  turn.strikes = {};
  turn.confirmed = [];
  turn.phase = "reviewing";
  turn.endsAt = game.now() + TIMING.reviewMs;
  scheduleTimeout(game, turn);
  // The review is for striking clues that mean the same thing: with fewer than two
  // left standing (or nobody left to look) there's nothing to do, so straight to the guess.
  const standing = Object.keys(turn.clues).filter((writer) => !turn.auto[writer]).length;
  if (standing < 2 || turn.writers.length === 0) await toGuessing(game, turn);
}

async function toGuessing(game: GuessContext, turn: UniqueTurn): Promise<void> {
  turn.phase = "guessing";
  turn.endsAt = game.now() + TIMING.guessMs;
  scheduleTimeout(game, turn);
}

function rewardSolved(game: GuessContext, turn: UniqueTurn): void {
  award(game, turn, turn.leadId, POINTS.solved);
  for (const writer of survivingWriters(turn)) award(game, turn, writer, POINTS.clue);
}

async function settle(game: GuessContext, turn: UniqueTurn, outcome: UniqueOutcome, guess: string | null): Promise<void> {
  turn.outcome = outcome;
  turn.guess = guess;
  if (outcome === "correct") rewardSolved(game, turn);
  await finishTurn(game, turn);
}

function everyoneConfirmed(turn: UniqueTurn): boolean {
  return turn.writers.every((writer) => turn.confirmed.includes(writer));
}

async function uniqueAction(game: GuessContext, turn: UniqueTurn, userId: number, action: WebAction): Promise<string | null> {
  const t = msgs(game);
  const isLead = userId === turn.leadId;
  const isWriter = turn.writers.includes(userId);

  switch (action.op) {
    case "clue": {
      if (!isWriter) return t.writersOnly;
      if (turn.phase !== "writing") return t.staleStep;
      const text = cleanInput(action.text, LIMITS.clueChars);
      if (!text) return t.emptyInput;
      if (/\s/.test(text)) return t.oneWord;
      turn.clues[userId] = text; // writing again replaces the earlier clue
      if (missingClues(turn).length === 0) await toReview(game, turn);
      return null;
    }
    case "strike": {
      if (!isWriter) return t.writersOnly;
      if (turn.phase !== "reviewing") return t.staleStep;
      const writer = Number(action.writer);
      if (turn.clues[writer] === undefined || turn.auto[writer]) return t.cantStrike;
      const strikers = turn.strikes[writer] ?? [];
      const next = strikers.includes(userId) ? strikers.filter((id) => id !== userId) : [...strikers, userId];
      if (next.length) turn.strikes[writer] = next;
      else delete turn.strikes[writer];
      return null;
    }
    case "confirm": {
      if (!isWriter) return t.writersOnly;
      if (turn.phase !== "reviewing") return t.staleStep;
      if (!turn.confirmed.includes(userId)) turn.confirmed.push(userId);
      if (everyoneConfirmed(turn)) await toGuessing(game, turn);
      return null;
    }
    case "guess": {
      if (!isLead) return t.guesserOnly;
      if (turn.phase !== "guessing") return t.staleStep;
      const text = cleanInput(action.text, LIMITS.guessChars);
      if (!text) return t.emptyInput;
      await settle(game, turn, isAnswer(text, turn.card) ? "correct" : "wrong", text);
      return null;
    }
    case "pass":
      if (!isLead) return t.guesserOnly;
      if (turn.phase !== "guessing") return t.staleStep;
      await settle(game, turn, "passed", null);
      return null;
    default:
      return t.staleStep;
  }
}

// ------------------------------------------------------------ page taps

async function onWebAction(game: GuessContext, userId: number, action: WebAction): Promise<string | null> {
  const t = msgs(game);
  const turn = game.room.state?.turn;
  if (!turn) return t.staleStep;
  const isPlayer = game.players().includes(userId);

  if (action.op === "next") {
    if (turn.phase !== "done") return t.turnNotDone;
    if (!isPlayer && userId !== game.room.hostId) return t.notPlayer;
    await startTurn(game);
    return null;
  }

  if (action.op === "accept") {
    if (userId !== game.room.hostId) return game.core.hostOnly;
    if (turn.mode !== "unique" || turn.phase !== "done" || turn.outcome !== "wrong" || turn.accepted) return t.notWrong;
    turn.accepted = true;
    turn.outcome = "correct";
    rewardSolved(game, turn);
    await game.refreshRoomMessage();
    return null;
  }

  // Everything else belongs to the turn in play and names it.
  if (action.turn !== turn.no) return t.staleStep;
  if (!isPlayer) return t.notPlayer;
  return turn.mode === "taboo" ? tabooAction(game, turn, userId, action) : uniqueAction(game, turn, userId, action);
}

// --------------------------------------------------------------- settings

function settingsKeyboard(roomId: number, settings: GuessSettings, lang: Lang): Keyboard {
  const t = guessMessages[lang];
  const cb = (...args: Array<string | number>) => settingCallback(roomId, ...args);
  const option = (label: string, on: boolean, data: string) => button(on ? `${G.check} ${label}` : label, data, on ? "primary" : undefined);
  return [
    MODE_SETTINGS.map((mode) => option(t.modes[mode], settings.mode === mode, cb("m", mode))),
    ROUNDS_CHOICES.map((rounds) => option(t.btnRounds(rounds), settings.rounds === rounds, cb("r", rounds))),
    SECONDS_CHOICES.map((seconds) => option(t.btnSeconds(seconds), settings.seconds === seconds, cb("s", seconds))),
  ];
}

/** The same choices as the settings keyboard, worded for the lobby page's rows. Turn length only matters when Off-limits is played. */
function settingRows(settings: GuessSettings, lang: Lang): WebSetting[] {
  const t = guessMessages[lang];
  const rows: WebSetting[] = [
    {
      key: "m",
      label: t.rowMode,
      options: MODE_SETTINGS.map((mode) => ({ value: mode, label: t.pickMode[mode], on: settings.mode === mode })),
    },
    {
      key: "r",
      label: t.rowRounds,
      options: ROUNDS_CHOICES.map((rounds) => ({ value: String(rounds), label: t.pickRounds(rounds), on: settings.rounds === rounds })),
    },
  ];
  if (settings.mode !== "unique") {
    rows.push({
      key: "s",
      label: t.rowSeconds,
      options: SECONDS_CHOICES.map((seconds) => ({ value: String(seconds), label: t.pickSeconds(seconds), on: settings.seconds === seconds })),
    });
  }
  return rows;
}

function applySetting(settings: GuessSettings, args: string[]): SettingsResult<GuessSettings> {
  const [key, value = ""] = args;
  const next: GuessSettings = { ...settings };
  switch (key) {
    case "m":
      if ((MODE_SETTINGS as string[]).includes(value)) next.mode = value as ModeSetting;
      break;
    case "r":
      if (ROUNDS_CHOICES.includes(Number(value))) next.rounds = Number(value);
      break;
    case "s":
      if (SECONDS_CHOICES.includes(Number(value))) next.seconds = Number(value);
      break;
  }
  return { settings: next };
}

// ---------------------------------------------------------------- module

export const guessGame: GameModule<GuessSettings, GuessState> = {
  id: "guess",
  minPlayers: 3,
  maxPlayers: 16,
  title: (lang) => guessMessages[lang].title,
  blurb: (lang) => guessMessages[lang].blurb,
  helpText: (lang) => guessMessages[lang].help(POINTS),

  defaultSettings: () => ({ mode: "mix", rounds: 1, seconds: 90 }),

  describeSettings(settings, lang) {
    const t = guessMessages[lang];
    const lines = [t.settingsLine(t.modes[settings.mode], settings.rounds)];
    if (settings.mode !== "unique") lines.push(t.settingsSeconds(settings.seconds));
    return lines;
  },

  settingRows,
  // Chat buttons stand alone, so they get their own wording ("每人 2 次" rather than the page's "2 次").
  settingsKeyboard: (room, lang) => settingsKeyboard(room.id, room.settings, lang),
  applySetting: (settings, args) => applySetting(settings, args),

  async start(game) {
    const players = game.players();
    game.room.state = {
      order: players,
      leads: {},
      turnNo: 0,
      scores: Object.fromEntries(players.map((id) => [String(id), 0])),
      usedCards: [],
      turn: null,
    };
    await startTurn(game);
  },

  // No onAction: nothing in the chat carries game buttons, it's all in the page.

  async onDeadline(game, kind, data) {
    const turn = game.room.state?.turn;
    if (!turn) return;
    if (kind === WRAP_UP) {
      if (turn.phase === "done" && noTurnsLeft(game)) await game.end();
      return;
    }
    if (kind !== PHASE || data.turn !== turn.no || data.phase !== turn.phase) return;
    if (turn.mode === "taboo") {
      if (turn.phase === "ready") await abortTurn(game, turn, "idle");
      else if (turn.phase === "describing") await endDescribing(game, turn);
      return;
    }
    if (turn.phase === "writing") await toReview(game, turn);
    else if (turn.phase === "reviewing") await toGuessing(game, turn);
    else if (turn.phase === "guessing") await settle(game, turn, "timeout", null);
  },

  async onPlayerJoined(game, userId) {
    const state = game.room.state;
    if (!state) return;
    if (!state.order.includes(userId)) state.order.push(userId);
    state.scores[userId] ??= 0;
  },

  async onPlayerLeft(game, userId) {
    const turn = game.room.state?.turn;
    if (!turn || turn.phase === "done") return;
    if (turn.leadId === userId) {
      await abortTurn(game, turn, "left");
      return;
    }
    if (turn.mode !== "unique" || !turn.writers.includes(userId)) return;
    turn.writers = turn.writers.filter((id) => id !== userId);
    turn.confirmed = turn.confirmed.filter((id) => id !== userId);
    if (turn.phase === "writing" && missingClues(turn).length === 0) await toReview(game, turn);
    else if (turn.phase === "reviewing" && everyoneConfirmed(turn)) await toGuessing(game, turn);
  },

  async onSkip(game) {
    const turn = game.room.state?.turn;
    if (!turn || turn.phase === "done") return msgs(game).nothingToSkip;
    await abortTurn(game, turn, "host");
    return null;
  },

  renderBoard,

  async finish(game) {
    const turn = game.room.state?.turn;
    if (turn && turn.phase !== "done") await abortTurn(game, turn, "ended", { quiet: true });
    commitTurn(game);
    return renderSummary(game);
  },

  renderLog: (game) => renderLog(game, game.core.logEmpty),
  renderStats,

  web: { view: guessView, onAction: onWebAction },
};
