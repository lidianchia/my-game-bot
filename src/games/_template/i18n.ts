import type { Lang } from "../../core/i18n";
import { G, signed } from "../../ui/glyphs";
import type { Side, SkipReason } from "./types";
import { POINTS } from "./types";

type Points = typeof POINTS;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Chat-side text: /help, the room message, /log, the summary, /stats, and the
 * notices for taps in the page. The page's own words are in
 * public/app/games/_template.js. No emoji (test/unit/style.test.ts checks).
 */
const zh = {
  title: "猜大小",
  blurb: "猜大小（模板游戏）",
  help: (p: Points) =>
    "<b>猜大小怎么玩</b>\n" +
    "1. 开房、拉人和其他游戏一样，人齐了房主点「开始」。大家点房间消息上的「打开游戏」进游戏页面。\n" +
    `2. 轮到你当主角时，秘密选一个 1 到 6 的数字，可以在语音里虚张声势。其他人猜大（4–6）还是小（1–3）：猜对的 ${signed(p.right)}，每有一个人猜错，你 ${signed(p.fooled)}。\n` +
    "3. 每人轮流当主角，轮完自动结束并发总结。",
  settingsLine: (rounds: number, seconds: number) => `每人当 ${rounds} 次主角 ${G.dot} 猜 ${seconds} 秒`,
  // One row per setting on the lobby page. The room message's settings panel shows the same
  // choices as buttons without the row's label, so each choice reads on its own.
  rowRounds: "主角",
  rowSeconds: "猜的时间",
  pickRounds: (rounds: number) => `每人 ${rounds} 次`,
  pickSeconds: (seconds: number) => `猜 ${seconds} 秒`,

  boardScores: "<b>比分</b>",
  boardLeft: "（已离开）",
  boardTurn: (no: number, total: number, lead: string) => `<b>第 ${no}/${total} 轮</b> ${G.dot} ${lead} 当主角`,
  boardFooter: "在「打开游戏」里玩 · 完整记录 /log",

  sides: { high: "大", low: "小" } satisfies Record<Side, string>,
  skipReason: { host: "房主跳过了这一轮", left: "主角离开了", idle: "主角没选数字", ended: "游戏提前结束" } satisfies Record<SkipReason, string>,

  logTitle: (roomId: number, turns: number) => `<b>猜大小 ${G.dot} 房间 #${roomId}</b> ${G.dot} ${turns} 轮`,
  logTurn: (no: number, lead: string, number: number) => `<b>#${no}</b> ${lead} 选了 ${number}`,
  logNoNumber: (no: number, lead: string) => `<b>#${no}</b> ${lead} 没选数字`,
  logGuesses: (calls: string) => `猜：${calls}`,
  logPoints: (points: string) => `本轮 ${points}`,

  summaryTitle: (roomId: number) => `<b>猜大小 ${G.dot} 房间 #${roomId} 结束</b>`,
  summaryMeta: (turns: number, minutes: number) => `${turns} 轮 ${G.dot} ${minutes} 分钟`,
  rankingTitle: "<b>排名</b>",
  rankingLine: (name: string, points: number) => `${name}　${signed(points)} 分`,

  statsTitle: (games: number, turns: number) => `<b>猜大小 ${G.dot} 历史统计</b> ${G.dot} ${games} 局 ${turns} 轮`,
  statsLine: (name: string, points: number, games: number) => `${name}　${signed(points)} 分 ${G.dot} ${games} 局`,
  personalTitle: (name: string) => `<b>${name} 的猜大小战绩</b>`,

  // Notices shown in the game page after a tap.
  staleStep: "这一步已经过去了",
  notPlayer: "你不在这一局里，只能看",
  leadOnly: "只有主角能选数字",
  guessersOnly: "这一轮你不用猜",
  badNumber: "选 1 到 6 之间的数字",
  turnNotDone: "这一轮还没结束",
  nothingToSkip: "现在没有可以跳过的",
};

export type HiLoMessages = typeof zh;

const en: HiLoMessages = {
  title: "High or Low",
  blurb: "High or Low (the template game)",
  help: (p: Points) =>
    "<b>How to play High or Low</b>\n" +
    "1. Open a room and bring people in as in any other game; the host taps “Start” when everyone's in. Everyone taps “Open game” on the room message to get to the game page.\n" +
    `2. When you lead, secretly pick a number from 1 to 6, and bluff about it in voice chat if you like. Everyone else guesses high (4–6) or low (1–3): ${signed(p.right)} for a right guess, and ${signed(p.fooled)} to you for each wrong one.\n` +
    "3. Everyone takes turns leading; when all turns are done the game ends with a summary.",
  settingsLine: (rounds: number, seconds: number) => `${plural(rounds, "lead")} each ${G.dot} ${seconds}s to guess`,
  rowRounds: "Leads",
  rowSeconds: "Guessing",
  pickRounds: (rounds: number) => `${rounds} each`,
  pickSeconds: (seconds: number) => `${seconds}s to guess`,

  boardScores: "<b>Scores</b>",
  boardLeft: "(left)",
  boardTurn: (no: number, total: number, lead: string) => `<b>Turn ${no}/${total}</b> ${G.dot} ${lead} leads`,
  boardFooter: "Play in “Open game” · full log /log",

  sides: { high: "high", low: "low" },
  skipReason: { host: "skipped by the host", left: "the lead left", idle: "the lead never picked", ended: "the game ended early" },

  logTitle: (roomId: number, turns: number) => `<b>High or Low ${G.dot} Room #${roomId}</b> ${G.dot} ${plural(turns, "turn")}`,
  logTurn: (no: number, lead: string, number: number) => `<b>#${no}</b> ${lead} picked ${number}`,
  logNoNumber: (no: number, lead: string) => `<b>#${no}</b> ${lead} didn't pick`,
  logGuesses: (calls: string) => `Calls: ${calls}`,
  logPoints: (points: string) => `turn ${points}`,

  summaryTitle: (roomId: number) => `<b>High or Low ${G.dot} Room #${roomId} finished</b>`,
  summaryMeta: (turns: number, minutes: number) => `${plural(turns, "turn")} ${G.dot} ${minutes} min`,
  rankingTitle: "<b>Ranking</b>",
  rankingLine: (name: string, points: number) => `${name}　${signed(points)}`,

  statsTitle: (games: number, turns: number) => `<b>High or Low ${G.dot} all-time</b> ${G.dot} ${plural(games, "game")}, ${plural(turns, "turn")}`,
  statsLine: (name: string, points: number, games: number) => `${name}　${signed(points)} ${G.dot} ${plural(games, "game")}`,
  personalTitle: (name: string) => `<b>${name} in High or Low</b>`,

  staleStep: "That step is already over",
  notPlayer: "You're not in this game; you can watch",
  leadOnly: "Only the lead picks the number",
  guessersOnly: "You don't guess this turn",
  badNumber: "Pick a number from 1 to 6",
  turnNotDone: "This turn isn't over yet",
  nothingToSkip: "There's nothing to skip right now",
};

export const hiLoMessages: Record<Lang, HiLoMessages> = { zh, en };
