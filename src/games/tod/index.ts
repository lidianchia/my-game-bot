import type { CallbackReply, GameModule } from "../../core/game";
import type { Lang } from "../../core/i18n";
import type { TgUser } from "../../telegram/intents";
import { button, type Keyboard } from "../../telegram/port";
import { roomCallback } from "../../telegram/callback";
import { G, heat } from "../../ui/glyphs";
import { generateQuestion } from "./ai";
import { drawCard } from "./deck";
import { todMessages } from "./i18n";
import {
  mainPassPoints,
  renderBoard,
  renderLog,
  renderStats,
  renderSummary,
  renderTurnCard,
  turnRecords,
  type TodContext,
} from "./render";
import {
  POINTS,
  TURN_LOG_KIND,
  type DareType,
  type Level,
  type QuestionKind,
  type Question,
  type Source,
  type TodKind,
  type TodSettings,
  type TodState,
  type Turn,
  type TurnRecord,
} from "./types";

const ALL_DARE_TYPES: DareType[] = ["voice", "post", "contact"];
const VOTE_SECONDS_CHOICES = [30, 60, 90];
const MAX_REROLLS = 3;
const RECENT_TEXTS_KEPT = 30;

// ---------------------------------------------------------------- the turn

async function spin(game: TodContext): Promise<void> {
  const state = game.room.state!;
  const players = game.players();
  if (players.length === 0) return;
  // Pure spin-the-bottle: every player is equally likely, including whoever just went.
  const playerId = players[Math.floor(game.random() * players.length)]!;
  const turn: Turn = {
    no: state.turnNo + 1,
    playerId,
    messageId: null,
    phase: "choosing",
    kind: null,
    question: null,
    rerolled: [],
    outcome: null,
    mainVote: null,
    penalty: null,
    penaltyOutcome: null,
    penaltyVote: null,
    vote: null,
    points: 0,
    skipReason: null,
    startedAt: game.now(),
    endedAt: null,
  };
  state.turnNo = turn.no;
  state.turn = turn;
  const card = renderTurnCard(game, turn);
  turn.messageId = await game.send(card.text, card.keyboard);
}

async function redraw(game: TodContext, turn: Turn, options: { showNext?: boolean; generating?: boolean } = {}): Promise<void> {
  if (turn.messageId === null) return;
  const card = renderTurnCard(game, turn, options);
  await game.edit(turn.messageId, card.text, card.keyboard);
}

function wantsAi(game: TodContext): boolean {
  const source = game.room.settings.source;
  if (!game.llm || source === "deck") return false;
  return source === "ai" || game.random() < 0.5;
}

/** AI first when the room asks for it; the deck is always the fallback, so a turn never stalls. */
async function drawQuestion(game: TodContext, turn: Turn, kind: QuestionKind): Promise<Question> {
  const state = game.room.state!;
  const settings = game.room.settings;
  let question: Question | null = null;

  if (wantsAi(game)) {
    await redraw(game, turn, { generating: true });
    try {
      const generated = await generateQuestion(game.llm!, {
        kind,
        level: settings.level,
        lang: game.lang,
        dareTypes: settings.dareTypes,
        avoid: state.recentTexts,
      });
      question = { text: generated.text, from: "ai", provider: generated.provider, level: settings.level, type: generated.type };
    } catch (error) {
      console.warn("AI question failed, using the deck", error);
    }
  }

  if (!question) {
    const card = drawCard(kind, {
      level: settings.level,
      dareTypes: settings.dareTypes,
      used: new Set(state.usedCards),
      random: () => game.random(),
    });
    state.usedCards.push(card.id);
    question = { text: card[game.lang], from: "deck", cardId: card.id, level: card.level, type: card.type };
  }

  state.recentTexts = [...state.recentTexts, question.text].slice(-RECENT_TEXTS_KEPT);
  return question;
}

function openVote(game: TodContext, turn: Turn, stage: "main" | "penalty"): void {
  const eligible = game.players().filter((id) => id !== turn.playerId);
  const closesAt = game.now() + game.room.settings.voteSeconds * 1000;
  turn.vote = { stage, yes: [], no: [], eligible, closesAt };
  turn.phase = stage === "main" ? "voting" : "penalty-voting";
  game.schedule("vote", closesAt, { turnNo: turn.no, stage });
}

/** Majority of votes cast wins; a tie (including nobody voting) gives the player the benefit of the doubt. */
async function resolveVote(game: TodContext, turn: Turn): Promise<void> {
  const vote = turn.vote;
  if (!vote) return;
  game.cancelSchedule("vote");
  const passed = vote.yes.length >= vote.no.length;
  const ballot = { yes: vote.yes, no: vote.no };
  turn.vote = null;

  if (vote.stage === "main") {
    turn.mainVote = ballot;
    if (passed) {
      turn.outcome = "pass";
      turn.points += mainPassPoints(turn);
      await finishTurn(game, turn);
      return;
    }
    turn.outcome = "fail";
    turn.points += POINTS.fail;
    await startPenalty(game, turn);
    return;
  }

  turn.penaltyVote = ballot;
  turn.penaltyOutcome = passed ? "pass" : "fail";
  turn.points += passed ? POINTS.penaltyPass : POINTS.penaltyFail;
  await finishTurn(game, turn);
}

async function startPenalty(game: TodContext, turn: Turn): Promise<void> {
  turn.phase = "penalty";
  turn.penalty = await drawQuestion(game, turn, "penalty");
  await redraw(game, turn);
}

async function finishTurn(game: TodContext, turn: Turn): Promise<void> {
  const state = game.room.state!;
  turn.phase = "done";
  turn.vote = null;
  turn.endedAt = game.now();
  if (turn.outcome === null) turn.outcome = "skipped";
  state.scores[turn.playerId] = (state.scores[turn.playerId] ?? 0) + turn.points;
  const record: TurnRecord = {
    v: 1,
    no: turn.no,
    playerId: turn.playerId,
    kind: turn.kind,
    level: turn.question?.level ?? game.room.settings.level,
    question: turn.question,
    rerolled: turn.rerolled,
    outcome: turn.outcome,
    mainVote: turn.mainVote,
    penalty: turn.penalty,
    penaltyOutcome: turn.penaltyOutcome,
    penaltyVote: turn.penaltyVote,
    points: turn.points,
    skipReason: turn.skipReason,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
  };
  game.log(TURN_LOG_KIND, turn.playerId, record);
  await redraw(game, turn, { showNext: true });
  await game.refreshRoomMessage();
}

/** Ends the current turn early (host skip, or the player left). Points already earned stand. */
async function abortTurn(game: TodContext, turn: Turn, reason: "host" | "left"): Promise<void> {
  game.cancelSchedule("vote");
  turn.skipReason = reason;
  if (turn.outcome === null) turn.outcome = "skipped";
  else if (turn.penalty && turn.penaltyOutcome === null) turn.penaltyOutcome = "skipped";
  await finishTurn(game, turn);
}

// ------------------------------------------------------------- the actions

async function handleAction(game: TodContext, args: string[], from: TgUser, reply: CallbackReply): Promise<void> {
  const t = todMessages[game.lang];
  const [action, turnNoRaw, choice] = args;
  const state = game.room.state;
  const turn = state?.turn;
  if (!state || !turn || Number(turnNoRaw) !== turn.no) {
    await reply.answer(t.staleTurn);
    return;
  }
  const isPerformer = from.id === turn.playerId;
  const isPlayer = game.players().includes(from.id);

  switch (action) {
    case "c": {
      if (turn.phase !== "choosing") return reply.answer(t.staleTurn);
      if (!isPerformer) return reply.answer(t.notYourTurn(game.plainName(turn.playerId)));
      await reply.answer();
      const kind: TodKind = choice === "d" ? "dare" : "truth";
      turn.kind = kind;
      turn.question = await drawQuestion(game, turn, kind);
      turn.phase = "performing";
      await redraw(game, turn);
      return;
    }

    case "rr": {
      if (turn.phase !== "performing" || !turn.kind || !turn.question) return reply.answer(t.staleTurn);
      if (!isPerformer) return reply.answer(t.notYourTurn(game.plainName(turn.playerId)));
      const used = state.rerollsUsed[from.id] ?? 0;
      if (used >= game.room.settings.rerolls) return reply.answer(t.noRerollsLeft);
      await reply.answer();
      state.rerollsUsed[from.id] = used + 1;
      turn.rerolled.push(turn.question);
      turn.question = null; // so the "AI is writing" card doesn't keep showing the old question
      turn.question = await drawQuestion(game, turn, turn.kind);
      await redraw(game, turn);
      return;
    }

    case "ch": {
      if (turn.phase !== "performing") return reply.answer(t.staleTurn);
      if (!isPerformer) return reply.answer(t.notYourTurn(game.plainName(turn.playerId)));
      await reply.answer();
      turn.outcome = "chicken";
      turn.points += POINTS.chicken;
      await startPenalty(game, turn);
      return;
    }

    case "dn": {
      if (turn.phase !== "performing" && turn.phase !== "penalty") return reply.answer(t.staleTurn);
      if (!isPerformer && from.id !== game.room.hostId) return reply.answer(t.performerOrHost);
      await reply.answer();
      openVote(game, turn, turn.phase === "performing" ? "main" : "penalty");
      if (turn.vote!.eligible.length === 0) {
        await resolveVote(game, turn); // nobody else left to vote: it passes
        return;
      }
      await redraw(game, turn);
      return;
    }

    case "v": {
      const vote = turn.vote;
      if (!vote || (turn.phase !== "voting" && turn.phase !== "penalty-voting")) return reply.answer(t.staleTurn);
      if (isPerformer) return reply.answer(t.cantVoteSelf);
      if (!vote.eligible.includes(from.id)) return reply.answer(isPlayer ? t.lateJoiner : t.notPlayer);
      const yes = choice === "y";
      vote.yes = vote.yes.filter((id) => id !== from.id);
      vote.no = vote.no.filter((id) => id !== from.id);
      (yes ? vote.yes : vote.no).push(from.id);
      await reply.answer(yes ? t.votedYes : t.votedNo);
      if (vote.yes.length + vote.no.length >= vote.eligible.length) await resolveVote(game, turn);
      else await redraw(game, turn);
      return;
    }

    case "nx": {
      if (turn.phase !== "done") return reply.answer(t.staleTurn);
      if (!isPlayer && from.id !== game.room.hostId) return reply.answer(t.notPlayer);
      await reply.answer();
      await redraw(game, turn, { showNext: false });
      await spin(game);
      return;
    }

    default:
      await reply.answer(t.staleTurn);
  }
}

// ---------------------------------------------------------------- settings

function settingsKeyboard(roomId: number, settings: TodSettings, lang: Lang): Keyboard {
  const t = todMessages[lang];
  const cb = (...args: Array<string | number>) => roomCallback(roomId, "st", ...args);
  // The chosen option is blue with a check; the check keeps it readable on clients without button colours.
  const option = (label: string, on: boolean, data: string) =>
    button(on ? `${G.check} ${label}` : label, data, on ? "primary" : undefined);
  return [
    ([1, 2, 3] as Level[]).map((level) =>
      option(`${t.levels[level]} ${heat(level)}`, settings.level === level, cb("lv", level)),
    ),
    (["deck", "ai", "mix"] as Source[]).map((source) => option(t.sources[source], settings.source === source, cb("src", source))),
    Array.from({ length: MAX_REROLLS + 1 }, (_, count) => option(t.btnRerolls(count), settings.rerolls === count, cb("rr", count))),
    ALL_DARE_TYPES.map((type) => option(t.dareTypes[type], settings.dareTypes.includes(type), cb("dt", type))),
    VOTE_SECONDS_CHOICES.map((seconds) =>
      option(t.btnVoteSeconds(seconds), settings.voteSeconds === seconds, cb("vs", seconds)),
    ),
  ];
}

function applySetting(settings: TodSettings, args: string[], lang: Lang, aiAvailable: boolean) {
  const t = todMessages[lang];
  const [key, value = ""] = args;
  const next: TodSettings = { ...settings, dareTypes: [...settings.dareTypes] };
  switch (key) {
    case "lv": {
      const level = Number(value);
      if (level === 1 || level === 2 || level === 3) next.level = level;
      break;
    }
    case "src":
      if (value !== "deck" && value !== "ai" && value !== "mix") break;
      if (value !== "deck" && !aiAvailable) return { alert: t.noAi };
      next.source = value;
      break;
    case "rr": {
      const count = Number(value);
      if (Number.isInteger(count) && count >= 0 && count <= MAX_REROLLS) next.rerolls = count;
      break;
    }
    case "dt": {
      const type = value as DareType;
      if (!ALL_DARE_TYPES.includes(type)) break;
      if (next.dareTypes.includes(type)) {
        if (next.dareTypes.length === 1) return { alert: t.needOneDareType };
        next.dareTypes = next.dareTypes.filter((existing) => existing !== type);
      } else {
        next.dareTypes = ALL_DARE_TYPES.filter((existing) => existing === type || next.dareTypes.includes(existing));
      }
      break;
    }
    case "vs": {
      const seconds = Number(value);
      if (VOTE_SECONDS_CHOICES.includes(seconds)) next.voteSeconds = seconds;
      break;
    }
  }
  return { settings: next };
}

// -------------------------------------------------------------- the module

export const truthOrDare: GameModule<TodSettings, TodState> = {
  id: "tod",
  minPlayers: 2,
  maxPlayers: 20,
  title: (lang) => todMessages[lang].title,
  helpText: (lang) => todMessages[lang].help(POINTS),

  defaultSettings: (aiAvailable) => ({
    level: 2,
    source: aiAvailable ? "mix" : "deck",
    rerolls: 2,
    dareTypes: [...ALL_DARE_TYPES],
    voteSeconds: 60,
  }),

  describeSettings(settings, lang) {
    const t = todMessages[lang];
    return [
      t.settingsLine(`${t.levels[settings.level]} ${heat(settings.level)}`, t.sources[settings.source], settings.rerolls),
      t.settingsLine2(settings.dareTypes.map((type) => t.dareTypes[type]).join(` ${G.dot} `), settings.voteSeconds),
    ];
  },

  settingsKeyboard: (room, lang) => settingsKeyboard(room.id, room.settings, lang),
  applySetting,

  async start(game) {
    const scores: Record<string, number> = {};
    for (const id of game.players()) scores[id] = 0;
    game.room.state = { turnNo: 0, scores, rerollsUsed: {}, usedCards: [], recentTexts: [], turn: null };
    await game.refreshRoomMessage();
    await spin(game);
  },

  onAction: handleAction,

  async onDeadline(game, kind, data) {
    const turn = game.room.state?.turn;
    if (kind !== "vote" || !turn?.vote) return;
    if (data.turnNo !== turn.no || data.stage !== turn.vote.stage) return;
    await resolveVote(game, turn);
  },

  async onPlayerJoined(game, userId) {
    const state = game.room.state;
    if (state && state.scores[userId] === undefined) state.scores[userId] = 0;
  },

  async onPlayerLeft(game, userId) {
    const turn = game.room.state?.turn;
    if (!turn || turn.phase === "done") return;
    if (turn.playerId === userId) {
      await abortTurn(game, turn, "left");
      return;
    }
    const vote = turn.vote;
    if (vote?.eligible.includes(userId)) {
      vote.eligible = vote.eligible.filter((id) => id !== userId);
      vote.yes = vote.yes.filter((id) => id !== userId);
      vote.no = vote.no.filter((id) => id !== userId);
      if (vote.yes.length + vote.no.length >= vote.eligible.length) await resolveVote(game, turn);
      else await redraw(game, turn);
    }
  },

  async onSkip(game) {
    const turn = game.room.state?.turn;
    if (!turn || turn.phase === "done") return todMessages[game.lang].nothingToSkip;
    await abortTurn(game, turn, "host");
    return null;
  },

  renderBoard,

  async finish(game) {
    game.cancelSchedule();
    const turn = game.room.state?.turn;
    if (turn && turn.phase !== "done") {
      if (turn.outcome !== null) {
        // The main outcome (fail/chicken) already happened; only the penalty is left hanging.
        turn.penaltyOutcome = "skipped";
        await finishTurn(game, turn);
        await redraw(game, turn, { showNext: false });
      } else if (turn.messageId !== null) {
        const card = renderTurnCard(game, turn, { abandoned: true });
        await game.edit(turn.messageId, card.text, card.keyboard);
      }
    } else if (turn) {
      await redraw(game, turn, { showNext: false });
    }
    return renderSummary(game, turnRecords(game.sql, game.room.id));
  },

  renderLog: (game) => renderLog(game, game.core.logEmpty),
  renderStats,
};
