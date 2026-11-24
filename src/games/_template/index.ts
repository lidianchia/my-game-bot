import type { GameModule, SettingsResult, WebAction } from "../../core/game";
import type { Lang } from "../../core/i18n";
import type { WebSetting } from "../../web/protocol";
import { hiLoMessages } from "./i18n";
import { renderBoard, renderLog, renderStats, renderSummary } from "./render";
import { nextLead, toRecord } from "./rules";
import {
  GAME_ID,
  POINTS,
  ROUNDS_CHOICES,
  SECONDS_CHOICES,
  TIMING,
  TURN_LOG_KIND,
  sideOf,
  type HiLoContext,
  type HiLoSettings,
  type HiLoState,
  type HiLoTurn,
  type SkipReason,
} from "./types";
import { hiLoView } from "./view";

/*
 * The game's flow. The core owns the room (players, invitations, the room
 * message, timers, saving); a game owns `room.state` and decides what happens.
 * Every handler gets a GameContext (`game`): room, language, players, names,
 * the turn log, timers, and `refreshRoomMessage()` to redraw the group's board.
 * After any handler, the core saves the room and pushes a fresh view to every
 * open game page, so handlers just change `room.state`.
 */

/** The one timer kind: the current phase ran out (see onDeadline). */
const PHASE = "phase";

const msgs = (game: HiLoContext) => hiLoMessages[game.lang];

/** Points count on the scoreboard straight away, not only when the turn ends. */
function award(game: HiLoContext, turn: HiLoTurn, userId: number, points: number): void {
  const state = game.room.state!;
  turn.points[userId] = (turn.points[userId] ?? 0) + points;
  state.scores[userId] = (state.scores[userId] ?? 0) + points;
}

/** Replaces the phase timer. The data names the turn and phase, so a timer that outlived them is ignored. */
function schedulePhase(game: HiLoContext, turn: HiLoTurn): void {
  game.cancelSchedule(PHASE);
  if (turn.endsAt !== null) game.schedule(PHASE, turn.endsAt, { turn: turn.no, phase: turn.phase });
}

// -------------------------------------------------------------- turn flow

async function startTurn(game: HiLoContext): Promise<void> {
  const state = game.room.state!;
  game.cancelSchedule(PHASE);
  const players = game.players();
  const lead = players.length >= 2 ? nextLead(state, players, game.room.settings.rounds) : null;
  if (lead === null) {
    await game.end(); // everyone has led: finish() runs, the summary goes out, the room closes
    return;
  }
  for (const id of players) if (!state.order.includes(id)) state.order.push(id);
  const now = game.now();
  state.turnNo += 1;
  state.leads[lead] = (state.leads[lead] ?? 0) + 1;
  state.turn = {
    no: state.turnNo,
    leadId: lead,
    phase: "picking",
    endsAt: now + TIMING.pickMs,
    number: null,
    guessers: players.filter((id) => id !== lead),
    guesses: {},
    points: {},
    skipReason: null,
    startedAt: now,
    endedAt: null,
  };
  schedulePhase(game, state.turn);
  await game.refreshRoomMessage();
}

/** Closes the turn and writes it to the turn log; on its own (no redraw, no timer) when the game is ending. */
function closeTurn(game: HiLoContext, turn: HiLoTurn, skipReason: SkipReason | null): void {
  turn.phase = "done";
  turn.skipReason = skipReason;
  turn.endedAt = game.now();
  turn.endsAt = null;
  game.cancelSchedule(PHASE);
  game.log(TURN_LOG_KIND, turn.leadId, toRecord(turn, turn.endedAt));
}

/** Closes the turn and leaves the result up for a while; the next turn starts after that (or on "next"). */
async function finishTurn(game: HiLoContext, turn: HiLoTurn, skipReason: SkipReason | null = null): Promise<void> {
  closeTurn(game, turn, skipReason);
  turn.endsAt = game.now() + TIMING.revealMs;
  schedulePhase(game, turn);
  await game.refreshRoomMessage();
}

async function reveal(game: HiLoContext, turn: HiLoTurn): Promise<void> {
  const answer = sideOf(turn.number!);
  for (const [userId, side] of Object.entries(turn.guesses)) {
    if (side === answer) award(game, turn, Number(userId), POINTS.right);
    else award(game, turn, turn.leadId, POINTS.fooled);
  }
  await finishTurn(game, turn);
}

const everyoneGuessed = (turn: HiLoTurn) => turn.guessers.every((id) => turn.guesses[id] !== undefined);

// -------------------------------------------------------------- page taps

/**
 * A tap in the game page: `{ a: "g", op, turn, ...fields }`. Anything here can
 * come late (the phase moved on) or from anyone with the page open, so check
 * the turn, the phase and the person before acting. The string returned is
 * shown to that person only.
 */
async function onWebAction(game: HiLoContext, userId: number, action: WebAction): Promise<string | null> {
  const t = msgs(game);
  const turn = game.room.state?.turn;
  // Taps name the turn they were meant for, so a late tap can't land on the next one.
  if (!turn || action.turn !== turn.no) return t.staleStep;

  switch (action.op) {
    case "pick": {
      if (userId !== turn.leadId) return t.leadOnly;
      if (turn.phase !== "picking") return t.staleStep;
      const number = Number(action.number);
      if (!Number.isInteger(number) || number < 1 || number > 6) return t.badNumber;
      turn.number = number;
      turn.phase = "guessing";
      turn.endsAt = game.now() + game.room.settings.seconds * 1000;
      schedulePhase(game, turn);
      if (everyoneGuessed(turn)) await reveal(game, turn); // nobody left to guess
      return null;
    }
    case "guess": {
      if (!turn.guessers.includes(userId)) return game.players().includes(userId) ? t.guessersOnly : t.notPlayer;
      if (turn.phase !== "guessing") return t.staleStep;
      if (action.side !== "high" && action.side !== "low") return t.staleStep;
      turn.guesses[userId] = action.side;
      if (everyoneGuessed(turn)) await reveal(game, turn);
      return null;
    }
    case "next": {
      if (turn.phase !== "done") return t.turnNotDone;
      if (!game.players().includes(userId) && userId !== game.room.hostId) return t.notPlayer;
      await startTurn(game);
      return null;
    }
    default:
      return t.staleStep;
  }
}

// --------------------------------------------------------------- settings

/** The settings, once: the lobby page shows these rows and the room message's settings panel is built from them. */
function settingRows(settings: HiLoSettings, lang: Lang): WebSetting[] {
  const t = hiLoMessages[lang];
  return [
    {
      key: "r",
      label: t.rowRounds,
      options: ROUNDS_CHOICES.map((rounds) => ({ value: String(rounds), label: t.pickRounds(rounds), on: settings.rounds === rounds })),
    },
    {
      key: "s",
      label: t.rowSeconds,
      options: SECONDS_CHOICES.map((seconds) => ({ value: String(seconds), label: t.pickSeconds(seconds), on: settings.seconds === seconds })),
    },
  ];
}

/** A pick from either place: `[key, value]`. Only values on offer count; a stale or forged one changes nothing. */
function applySetting(settings: HiLoSettings, args: string[]): SettingsResult<HiLoSettings> {
  const [key, value = ""] = args;
  const number = Number(value);
  if (key === "r" && ROUNDS_CHOICES.includes(number)) return { settings: { ...settings, rounds: number } };
  if (key === "s" && SECONDS_CHOICES.includes(number)) return { settings: { ...settings, seconds: number } };
  return {};
}

// ----------------------------------------------------------------- module

export const templateGame: GameModule<HiLoSettings, HiLoState> = {
  id: GAME_ID,
  minPlayers: 2,
  maxPlayers: 12,
  title: (lang) => hiLoMessages[lang].title,
  blurb: (lang) => hiLoMessages[lang].blurb,
  helpText: (lang) => hiLoMessages[lang].help(POINTS),

  defaultSettings: () => ({ rounds: 1, seconds: 30 }),
  describeSettings: (settings, lang) => [hiLoMessages[lang].settingsLine(settings.rounds, settings.seconds)],
  settingRows,
  // No settingsKeyboard: the room message's panel comes from settingRows.
  applySetting: (settings, args) => applySetting(settings, args),

  async start(game) {
    const players = game.players();
    game.room.state = { order: players, leads: {}, turnNo: 0, scores: Object.fromEntries(players.map((id) => [String(id), 0])), turn: null };
    await startTurn(game);
  },

  // No onAction: the game sends no buttons to the chat. A chat game (like tod) handles
  // presses on `game.callback(...)` buttons there.

  async onDeadline(game, kind, data) {
    const turn = game.room.state?.turn;
    if (kind !== PHASE || !turn || data.turn !== turn.no || data.phase !== turn.phase) return;
    if (turn.phase === "picking") await finishTurn(game, turn, "idle");
    else if (turn.phase === "guessing") await reveal(game, turn);
    else await startTurn(game); // the result has been up long enough
  },

  // Latecomers get a score and a place in the lead order; they guess from the next turn on.
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
      await finishTurn(game, turn, "left");
      return;
    }
    if (!turn.guessers.includes(userId)) return;
    turn.guessers = turn.guessers.filter((id) => id !== userId);
    delete turn.guesses[userId];
    if (turn.phase === "guessing" && everyoneGuessed(turn)) await reveal(game, turn);
  },

  /** The host's "skip turn" on the room message. */
  async onSkip(game) {
    const turn = game.room.state?.turn;
    if (!turn || turn.phase === "done") return msgs(game).nothingToSkip;
    await finishTurn(game, turn, "host");
    return null;
  },

  renderBoard,

  /** The game is ending (all turns played, /end, idle): close a turn in progress, then the summary. */
  async finish(game) {
    const turn = game.room.state?.turn;
    if (turn && turn.phase !== "done") closeTurn(game, turn, "ended");
    return renderSummary(game);
  },

  renderLog: (game) => renderLog(game, game.core.logEmpty),
  renderStats,

  web: { view: hiLoView, onAction: onWebAction },
};
