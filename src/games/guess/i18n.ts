import type { Lang } from "../../core/i18n";
import { G, signed } from "../../ui/glyphs";
import type { ModeSetting, SkipReason, TabooOutcome, UniqueOutcome } from "./types";
import { POINTS } from "./types";

type Points = typeof POINTS;

function minutesZh(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

function minutesEn(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Chat-side text for the word game. The page has its own strings in public/app/i18n.js. No emoji (see core/i18n.ts). */
const zh = {
  title: "心照不宣",
  help: (p: Points) =>
    "<b>心照不宣怎么玩</b>\n" +
    "1. 群里发 /guess 开房，拉人和真心话大冒险一样，人齐了房主点「开始」。大家点房间消息上的「打开游戏」进游戏页面。\n" +
    `2. <b>禁词</b>：轮到你描述时，页面上有一个词和 4 个禁用词。在语音里描述（也可以打字提示），不能说出这个词和禁用词。其他人在页面里打字猜，猜中一个，猜的人和你各 ${signed(p.guessed)}；你说漏了，谁都可以点「犯规」，你 ${signed(p.foul)}。\n` +
    `3. <b>别撞车</b>：轮到你猜时，其他人都看得到一个词，每人写一个词当线索。写得一样的互相抵消，意思太像的大家可以划掉。你只看得到剩下的线索，猜一次：猜对 ${signed(p.solved)}，留下来的线索每条 ${signed(p.clue)}。\n` +
    "4. 每人轮流当主角（描述或者猜），轮完自动结束并发总结。/log 看每一轮，/stats 看历史统计。",
  modes: { mix: "两种轮流", taboo: "禁词", unique: "别撞车" } satisfies Record<ModeSetting, string>,
  settingsLine: (mode: string, rounds: number) => `玩法：${mode} ${G.dot} 每人当 ${rounds} 次主角`,
  settingsSeconds: (seconds: number) => `禁词每轮 ${seconds} 秒`,
  btnRounds: (rounds: number) => `每人 ${rounds} 次`,
  btnSeconds: (seconds: number) => `禁词 ${seconds} 秒`,
  // The game page's lobby: one row per setting, short choices side by side.
  rowMode: "玩法",
  rowRounds: "每人当主角",
  rowSeconds: "禁词每轮",
  pickMode: { mix: "两种轮流", taboo: "禁词", unique: "别撞车" } satisfies Record<ModeSetting, string>,
  pickRounds: (rounds: number) => `${rounds} 次`,
  pickSeconds: (seconds: number) => `${seconds} 秒`,

  boardScores: "<b>比分</b>",
  boardLeft: "（已离开）",
  boardTaboo: (no: number, total: number, lead: string) => `<b>第 ${no}/${total} 轮</b> ${G.dot} 禁词 ${G.dot} ${lead} 描述`,
  boardUnique: (no: number, total: number, lead: string) => `<b>第 ${no}/${total} 轮</b> ${G.dot} 别撞车 ${G.dot} ${lead} 猜`,
  boardTurnDone: "这一轮结束了，在游戏页面点「下一轮」继续",
  boardFooter: "在「打开游戏」里玩 · 完整记录 /log",

  tabooOutcome: { guessed: G.check, skipped: "跳过", buzzed: "犯规", slipped: "说漏", timeout: "没猜完" } satisfies Record<TabooOutcome, string>,
  uniqueOutcome: { correct: "猜对了", wrong: "猜错了", passed: "放弃了", timeout: "超时没猜" } satisfies Record<UniqueOutcome, string>,
  skipReason: { host: "房主跳过了这一轮", left: "主角离开了", idle: "描述的人没开始", ended: "游戏提前结束" } satisfies Record<SkipReason, string>,
  pts: (points: number) => `${signed(points)} 分`,

  logTitle: (roomId: number, turns: number) => `<b>心照不宣 ${G.dot} 房间 #${roomId}</b> ${G.dot} ${turns} 轮`,
  logTaboo: (no: number, lead: string) => `<b>#${no}</b> 禁词 ${G.dot} ${lead} 描述`,
  logUnique: (no: number, lead: string) => `<b>#${no}</b> 别撞车 ${G.dot} ${lead} 猜`,
  logNoCards: "一个词都没来得及描述",
  logGuessedBy: (who: string) => `（${who}）`,
  logBuzzedBy: (who: string) => `（${who} 喊的）`,
  logWord: (word: string) => `词：${word}`,
  logClues: (clues: string) => `线索：${clues}`,
  logNoClues: "线索：一条也没剩",
  logRemoved: { duplicate: "（撞车）", answer: "（露底）", struck: "（划掉）" },
  logGuess: (guess: string, outcome: string) => `猜「${guess}」${G.dot} ${outcome}`,
  logAccepted: "（房主判对）",
  logPoints: (points: string) => `本轮 ${points}`,

  summaryTitle: (roomId: number) => `<b>心照不宣 ${G.dot} 房间 #${roomId} 结束</b>`,
  summaryMeta: (turns: number, duration: string) => `${turns} 轮 ${G.dot} ${duration}`,
  rankingTitle: "<b>排名</b>",
  rankingLine: (name: string, points: number) => `${name}　${signed(points)} 分`,
  highlightsTitle: "<b>本局之最</b>",
  bestDescriber: (name: string, count: number) => `描述最清楚：${name}，让大家猜中 ${count} 个`,
  bestGuesser: (name: string, count: number) => `抢答最快：${name}，猜中 ${count} 个`,
  mostUnique: (name: string, count: number) => `最不撞车：${name}，留下 ${count} 条线索`,
  solvedRate: (solved: number, total: number) => `别撞车猜中 ${solved}/${total}`,
  duration: minutesZh,

  statsTitle: (games: number, turns: number) => `<b>心照不宣 ${G.dot} 历史统计</b> ${G.dot} ${games} 局 ${turns} 轮`,
  statsLine: (name: string, points: number, games: number, wins: number) => `${name}　${signed(points)} 分 ${G.dot} ${games} 局 ${G.dot} 赢 ${wins} 局`,
  statsDetail: (described: number, guessed: number, solved: number, clues: number) =>
    `　禁词：描述成功 ${described}，猜中 ${guessed} ${G.dot} 别撞车：猜对 ${solved}，留下线索 ${clues}`,
  personalTitle: (name: string) => `<b>${name} 的心照不宣战绩</b>`,

  // Notices shown in the game page after a tap.
  notPlayer: "你不在这一局里，只能看",
  staleStep: "这一步已经过去了",
  cardGone: "这个词已经过去了",
  emptyInput: "先写点什么",
  describerOnly: "只有描述的人能这么做",
  describerCantGuess: "你在描述，不能猜",
  describerCantBuzz: "你自己在描述",
  guesserOnly: "只有猜的人能这么做",
  writersOnly: "这一轮你不用写线索",
  oneWord: "线索只能是一个词，不能有空格",
  cantStrike: "这条已经去掉了",
  notWrong: "只有猜错的才能改判",
  turnNotDone: "这一轮还没结束",
  nothingToSkip: "现在没有可以跳过的",
  useTheApp: "这个游戏在「打开游戏」里玩",
};

export type GuessMessages = typeof zh;

const en: GuessMessages = {
  title: "Unsaid",
  help: (p: Points) =>
    "<b>How to play Unsaid</b>\n" +
    "1. Send /guess in the group to open a room. Joining works like Truth or Dare; the host taps “Start” when everyone's in. Everyone taps “Open game” on the room message to get to the game page.\n" +
    `2. <b>Off-limits</b>: when it's your turn to describe, the page shows a word and 4 off-limits words. Describe it in voice chat (or type hints) without saying the word or any off-limits word. Everyone else types guesses; each word guessed gives the guesser and you ${signed(p.guessed)}. Slip up and anyone can tap “Foul”: ${signed(p.foul)} for you.\n` +
    `3. <b>Unique Clues</b>: when it's your turn to guess, everyone else sees a word and writes a one-word clue. Identical clues cancel out, and they strike any that mean the same. You see only the clues left and get one guess: ${signed(p.solved)} if right, plus ${signed(p.clue)} for each surviving clue's writer.\n` +
    "4. Everyone takes turns leading (describing or guessing); when all turns are done the game ends with a summary. /log shows every turn, /stats the all-time numbers.",
  modes: { mix: "Both, alternating", taboo: "Off-limits", unique: "Unique Clues" },
  settingsLine: (mode: string, rounds: number) => `Mode: ${mode} ${G.dot} ${plural(rounds, "turn")} each`,
  settingsSeconds: (seconds: number) => `Off-limits turns last ${seconds}s`,
  btnRounds: (rounds: number) => `${plural(rounds, "turn")} each`,
  btnSeconds: (seconds: number) => `Off-limits ${seconds}s`,
  rowMode: "Mode",
  rowRounds: "Turns each",
  rowSeconds: "Off-limits turn",
  pickMode: { mix: "Both", taboo: "Off-limits", unique: "Unique Clues" },
  pickRounds: (rounds: number) => String(rounds),
  pickSeconds: (seconds: number) => `${seconds}s`,

  boardScores: "<b>Scores</b>",
  boardLeft: "(left)",
  boardTaboo: (no: number, total: number, lead: string) => `<b>Turn ${no}/${total}</b> ${G.dot} Off-limits ${G.dot} ${lead} describes`,
  boardUnique: (no: number, total: number, lead: string) => `<b>Turn ${no}/${total}</b> ${G.dot} Unique Clues ${G.dot} ${lead} guesses`,
  boardTurnDone: "Turn over; tap “Next turn” in the game page to go on",
  boardFooter: "Play in “Open game” · full log /log",

  tabooOutcome: { guessed: G.check, skipped: "skipped", buzzed: "foul", slipped: "slipped", timeout: "time up" },
  uniqueOutcome: { correct: "right", wrong: "wrong", passed: "passed", timeout: "ran out of time" },
  skipReason: { host: "skipped by the host", left: "the lead left", idle: "the describer never started", ended: "the game ended early" },
  pts: (points: number) => `${signed(points)} ${Math.abs(points) === 1 ? "pt" : "pts"}`,

  logTitle: (roomId: number, turns: number) => `<b>Unsaid ${G.dot} Room #${roomId}</b> ${G.dot} ${plural(turns, "turn")}`,
  logTaboo: (no: number, lead: string) => `<b>#${no}</b> Off-limits ${G.dot} ${lead} describes`,
  logUnique: (no: number, lead: string) => `<b>#${no}</b> Unique Clues ${G.dot} ${lead} guesses`,
  logNoCards: "no words described",
  logGuessedBy: (who: string) => ` (${who})`,
  logBuzzedBy: (who: string) => ` (called by ${who})`,
  logWord: (word: string) => `Word: ${word}`,
  logClues: (clues: string) => `Clues: ${clues}`,
  logNoClues: "Clues: none left",
  logRemoved: { duplicate: " (clash)", answer: " (gave it away)", struck: " (struck)" },
  logGuess: (guess: string, outcome: string) => `Guessed “${guess}” ${G.dot} ${outcome}`,
  logAccepted: " (host ruled it right)",
  logPoints: (points: string) => `turn ${points}`,

  summaryTitle: (roomId: number) => `<b>Unsaid ${G.dot} Room #${roomId} finished</b>`,
  summaryMeta: (turns: number, duration: string) => `${plural(turns, "turn")} ${G.dot} ${duration}`,
  rankingTitle: "<b>Ranking</b>",
  rankingLine: (name: string, points: number) => `${name}　${signed(points)}`,
  highlightsTitle: "<b>Highlights</b>",
  bestDescriber: (name: string, count: number) => `Clearest describer: ${name}, ${plural(count, "word")} guessed`,
  bestGuesser: (name: string, count: number) => `Fastest guesser: ${name}, ${plural(count, "word")}`,
  mostUnique: (name: string, count: number) => `Most original: ${name}, ${plural(count, "clue")} survived`,
  solvedRate: (solved: number, total: number) => `Unique Clues solved ${solved}/${total}`,
  duration: minutesEn,

  statsTitle: (games: number, turns: number) => `<b>Unsaid ${G.dot} all-time</b> ${G.dot} ${plural(games, "game")}, ${plural(turns, "turn")}`,
  statsLine: (name: string, points: number, games: number, wins: number) =>
    `${name}　${signed(points)} ${G.dot} ${plural(games, "game")} ${G.dot} ${plural(wins, "win")}`,
  statsDetail: (described: number, guessed: number, solved: number, clues: number) =>
    `　Off-limits: ${described} described, ${guessed} guessed ${G.dot} Unique Clues: ${solved} solved, ${plural(clues, "clue")} survived`,
  personalTitle: (name: string) => `<b>${name} in Unsaid</b>`,

  notPlayer: "You're not in this game; you can watch",
  staleStep: "That step is already over",
  cardGone: "That word is already done",
  emptyInput: "Type something first",
  describerOnly: "Only the describer can do that",
  describerCantGuess: "You're describing; you can't guess",
  describerCantBuzz: "You're the one describing",
  guesserOnly: "Only the guesser can do that",
  writersOnly: "You don't write a clue this turn",
  oneWord: "A clue is one word, no spaces",
  cantStrike: "That clue is already out",
  notWrong: "Only a wrong guess can be overruled",
  turnNotDone: "This turn isn't over yet",
  nothingToSkip: "There's nothing to skip right now",
  useTheApp: "This game is played in “Open game”",
};

export const guessMessages: Record<Lang, GuessMessages> = { zh, en };
