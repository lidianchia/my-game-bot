import type { Lang } from "../../core/i18n";
import { G, signed } from "../../ui/glyphs";
import type { DareType, Level, MainOutcome, PenaltyOutcome, Source, TodKind } from "./types";
import { POINTS } from "./types";

type Points = typeof POINTS;

/** No emoji here either: see the style rule in core/i18n.ts. */
const zh = {
  title: "真心话大冒险",
  help: (p: Points) =>
    "<b>真心话大冒险怎么玩</b>\n" +
    "1. 群里发 /play 开房，开房的人是房主。房主点「邀请」或发 /invite @用户名 拉人，对方点「接受」才进；其他人点「申请加入」，房主同意后进。\n" +
    "2. 房主点「设置」选尺度（轻松、微辣、重口）、题目来源（题库、AI、题库 + AI）、每人换题次数、大冒险类型和投票时长，然后点「开始」。\n" +
    "3. 每轮转瓶子，完全随机选一个人（可能连着选中同一个人），被选中的人选真心话或大冒险。\n" +
    "4. 在语音里回答或做完大冒险，点「做完了」，其他人投「过」或「不过」，平票算过。\n" +
    `5. 真心话过关 ${signed(p.truthPass)}，大冒险过关 ${signed(p.darePass)}；没过 ${signed(p.fail)}、怂了 ${signed(p.chicken)}，然后做一道惩罚题（不能再怂）：完成 ${signed(p.penaltyPass)}，没过 ${signed(p.penaltyFail)}。\n` +
    "6. 房间消息会变成实时战报；结束时发本局总结，/log 看完整记录，/stats 看历史统计。",
  levels: { 1: "轻松", 2: "微辣", 3: "重口" } satisfies Record<Level, string>,
  sources: { deck: "题库", ai: "AI", mix: "题库 + AI" } satisfies Record<Source, string>,
  dareTypes: { voice: "语音", post: "群里发", contact: "联系群外" } satisfies Record<DareType, string>,
  kinds: { truth: "真心话", dare: "大冒险" } satisfies Record<TodKind, string>,
  questionFrom: { deck: "题库", ai: "AI" },
  settingsLine: (heat: string, source: string, rerolls: number) => `${heat} ${G.dot} ${source} ${G.dot} 每人可换 ${rerolls} 题`,
  settingsLine2: (types: string, seconds: number) => `大冒险：${types} ${G.dot} 投票 ${seconds} 秒`,
  btnRerolls: (count: number) => `换题 ${count}`,
  btnVoteSeconds: (seconds: number) => `投票 ${seconds} 秒`,
  noAi: "没有配置 AI key，只能用题库",
  needOneDareType: "至少要留一种大冒险类型",

  turnTitle: (no: number) => `<b>第 ${no} 轮</b>`,
  spunTo: (who: string) => `瓶子转到了 ${who}`,
  chooseQuestion: "真心话，还是大冒险？",
  btnTruth: "真心话",
  btnDare: "大冒险",
  generating: "AI 正在出题…",
  performHint: "在语音里回答或做完后点「做完了」，大家投票。",
  btnDone: "做完了，开始投票",
  btnReroll: (left: number) => `${G.reroll} 换一题 ${G.dot} 剩 ${left}`,
  btnChicken: "怂了",
  rerolledNote: (count: number) => `换过 ${count} 次`,
  votingTitle: (seconds: number) => `<b>投票</b> ${G.dot} ${seconds} 秒内 ${G.dot} 平票算过`,
  waitingFor: (names: string) => `还没投：${names}`,
  btnYes: (count: number) => `${G.check} 过 ${G.dot} ${count}`,
  btnNo: (count: number) => `${G.cross} 不过 ${G.dot} ${count}`,
  passLine: (yes: number, no: number, points: string) => `<b>${G.check} 过关</b> ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  failLine: (yes: number, no: number, points: string) => `<b>${G.cross} 没过</b> ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  chickenLine: (points: string) => `<b>怂了</b> ${G.dot} ${points}`,
  penaltyTitle: `<b>惩罚题</b> ${G.dot} 这次不能怂`,
  penaltyHint: "做完点「做完了」，大家再投一次。",
  penaltyPassLine: (yes: number, no: number, points: string) => `惩罚题 ${G.check} 完成 ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  penaltyFailLine: (yes: number, no: number, points: string) => `惩罚题 ${G.cross} 没过 ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  penaltySkippedLine: "惩罚题跳过了",
  turnTotal: (points: string) => `本轮合计 ${points}`,
  skippedByHost: "房主跳过了这一轮",
  skippedLeft: (who: string) => `${who} 离开了房间，这一轮作废`,
  abandoned: "游戏结束了，这一轮不算",
  btnNext: "下一轮",
  points: (value: number) => `${signed(value)} 分`,

  staleTurn: "这一轮已经过去了",
  notYourTurn: (who: string) => `现在是 ${who} 的回合`,
  performerOrHost: "只有本人或房主能点",
  noRerollsLeft: "这局的换题次数用完了",
  cantVoteSelf: "不能给自己投票哦",
  lateJoiner: "你是投票开始后才进来的，这轮不能投",
  votedYes: "你投了「过」",
  votedNo: "你投了「不过」",
  notPlayer: "你不在房间里",
  nothingToSkip: "现在没有可以跳过的回合",

  boardScores: "<b>积分</b>",
  boardRecent: "<b>最近几轮</b>",
  boardFooter: "完整记录 /log",
  boardNoTurns: "瓶子马上开转",
  boardLeft: "（已离开）",
  compactChicken: "怂",
  compactPenalty: "罚",
  compactSkipped: "跳过",
  logPenalty: "惩罚：",

  logTitle: (roomId: number, turns: number) => `<b>真心话大冒险 ${G.dot} 房间 #${roomId}</b> ${G.dot} ${turns} 轮`,
  outcome: { pass: `${G.check} 过关`, fail: `${G.cross} 没过`, chicken: "怂了", skipped: "跳过" } satisfies Record<MainOutcome, string>,
  penaltyOutcome: { pass: G.check, fail: G.cross, skipped: "跳过" } satisfies Record<PenaltyOutcome, string>,
  logRerolled: (count: number) => `换过 ${count} 次题`,
  logVotes: (yes: number, no: number) => ` ${G.dot} ${yes} : ${no}`,
  logTurnTotal: (points: string, duration: string) => `本轮 ${points} ${G.dot} 用时 ${duration}`,

  summaryTitle: (roomId: number) => `<b>真心话大冒险 ${G.dot} 房间 #${roomId} 结束</b>`,
  summaryMeta: (turns: number, duration: string) => `${turns} 轮 ${G.dot} ${duration}`,
  rankingTitle: "<b>排名</b>",
  rankingLine: (name: string, points: number, truths: number, dares: number, passes: number, turns: number, chickens: number) =>
    `${name}　${signed(points)} 分 ${G.dot} 真心话 ${truths} ${G.dot} 大冒险 ${dares} ${G.dot} 过关 ${passes}/${turns}${chickens ? ` ${G.dot} 怂 ${chickens}` : ""}`,
  rankingNeverPicked: (name: string, points: number) => `${name}　${signed(points)} 分 ${G.dot} 这局没被转到`,
  highlightsTitle: "<b>本局之最</b>",
  bravest: (name: string, count: number) => `最勇　${name} ${G.dot} 大冒险 ${count} 次`,
  mostChicken: (name: string, count: number) => `最怂　${name} ${G.dot} 怂了 ${count} 次`,
  penaltyKing: (name: string, count: number) => `惩罚专业户　${name} ${G.dot} 惩罚题 ${count} 次`,
  longest: (no: number, name: string, duration: string) => `最久的一轮　#${no} ${name} ${G.dot} ${duration}`,

  statsTitle: (games: number, turns: number) => `<b>真心话大冒险 ${G.dot} 历史统计</b> ${G.dot} ${games} 局 ${turns} 轮`,
  statsLine: (name: string, points: number, games: number, wins: number, turns: number, darePct: number, passPct: number, chickens: number) =>
    `${name}　${signed(points)} 分 ${G.dot} ${games} 局 ${wins} 胜 ${G.dot} ${turns} 轮 ${G.dot} 大冒险 ${darePct}% ${G.dot} 过关 ${passPct}%${chickens ? ` ${G.dot} 怂 ${chickens}` : ""}`,
  statsLineNeverPicked: (name: string, games: number) => `${name}　0 分 ${G.dot} ${games} 局 ${G.dot} 还没被瓶子转到过`,
  personalTitle: (name: string) => `<b>${name} 的真心话大冒险战绩</b>`,
  personalTotals: (points: number, games: number, wins: number) => `总积分 ${signed(points)} ${G.dot} ${games} 局 ${G.dot} ${wins} 胜`,
  personalTurns: (turns: number, truths: number, dares: number) => `被转到 ${turns} 次 ${G.dot} 真心话 ${truths} ${G.dot} 大冒险 ${dares}`,
  personalResults: (passes: number, fails: number, chickens: number, penalties: number, penaltyPasses: number) =>
    `过关 ${passes} ${G.dot} 没过 ${fails} ${G.dot} 怂 ${chickens} ${G.dot} 惩罚题 ${penalties}（完成 ${penaltyPasses}）`,
  personalMisc: (rerolls: number, average: string) => `换题 ${rerolls} 次 ${G.dot} 平均每轮 ${average}`,
  personalNone: (name: string) => `${name} 还没被瓶子转到过。`,

  duration: (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours} 小时 ${minutes} 分`;
    if (minutes) return `${minutes} 分 ${seconds} 秒`;
    return `${seconds} 秒`;
  },
};

export type TodMessages = typeof zh;

/** "1 dare" / "3 dares" */
function count(value: number, one: string, many = `${one}s`): string {
  return `${value} ${value === 1 ? one : many}`;
}

const en: TodMessages = {
  title: "Truth or Dare",
  help: (p: Points) =>
    "<b>How to play Truth or Dare</b>\n" +
    "1. Send /play in the group to open a room; whoever opens it is the host. The host taps “Invite” or sends /invite @username, and invitees tap “Accept” to join. Anyone else taps “Ask to join” and waits for the host.\n" +
    "2. The host taps “Settings” to pick the heat (mild, spicy, 18+), where questions come from (deck, AI, deck + AI), free skips per player, dare types and vote time, then taps “Start”.\n" +
    "3. Each round the bottle picks someone completely at random (the same person can come up twice in a row). They choose truth or dare.\n" +
    "4. Answer on the voice call or do the dare, then tap “Done”. Everyone else votes pass or fail; a tie counts as a pass.\n" +
    `5. Truth passed ${signed(p.truthPass)}, dare passed ${signed(p.darePass)}. Failing the vote is ${signed(p.fail)} and chickening out ${signed(p.chicken)}, followed by a penalty dare you can't refuse: done ${signed(p.penaltyPass)}, failed ${signed(p.penaltyFail)}.\n` +
    "6. The room message turns into a live scoreboard. A summary is posted at the end; /log shows every turn and /stats the all-time numbers.",
  levels: { 1: "Mild", 2: "Spicy", 3: "18+" },
  sources: { deck: "Deck", ai: "AI", mix: "Deck + AI" },
  dareTypes: { voice: "Voice", post: "Post in group", contact: "Outside contact" },
  kinds: { truth: "Truth", dare: "Dare" },
  questionFrom: { deck: "Deck", ai: "AI" },
  settingsLine: (heat: string, source: string, rerolls: number) => `${heat} ${G.dot} ${source} ${G.dot} ${count(rerolls, "free skip")} each`,
  settingsLine2: (types: string, seconds: number) => `Dares: ${types} ${G.dot} Vote ${seconds}s`,
  btnRerolls: (skips: number) => `Skips ${skips}`,
  btnVoteSeconds: (seconds: number) => `Vote ${seconds}s`,
  noAi: "No AI key configured; only the deck is available",
  needOneDareType: "Keep at least one dare type",

  turnTitle: (no: number) => `<b>Round ${no}</b>`,
  spunTo: (who: string) => `The bottle points at ${who}`,
  chooseQuestion: "Truth or dare?",
  btnTruth: "Truth",
  btnDare: "Dare",
  generating: "The AI is writing your question…",
  performHint: "Answer on the call or do the dare, then tap “Done” and everyone votes.",
  btnDone: "Done, start the vote",
  btnReroll: (left: number) => `${G.reroll} New question ${G.dot} ${left} left`,
  btnChicken: "Chicken out",
  rerolledNote: (skipped: number) => `skipped ${count(skipped, "question")}`,
  votingTitle: (seconds: number) => `<b>Vote</b> ${G.dot} ${seconds}s ${G.dot} a tie passes`,
  waitingFor: (names: string) => `Still to vote: ${names}`,
  btnYes: (votes: number) => `${G.check} Pass ${G.dot} ${votes}`,
  btnNo: (votes: number) => `${G.cross} Fail ${G.dot} ${votes}`,
  passLine: (yes: number, no: number, points: string) => `<b>${G.check} Passed</b> ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  failLine: (yes: number, no: number, points: string) => `<b>${G.cross} Failed</b> ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  chickenLine: (points: string) => `<b>Chickened out</b> ${G.dot} ${points}`,
  penaltyTitle: `<b>Penalty</b> ${G.dot} no chickening out this time`,
  penaltyHint: "Tap “Done” when it's done, and everyone votes again.",
  penaltyPassLine: (yes: number, no: number, points: string) => `Penalty ${G.check} done ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  penaltyFailLine: (yes: number, no: number, points: string) => `Penalty ${G.cross} failed ${G.dot} ${yes} : ${no} ${G.dot} ${points}`,
  penaltySkippedLine: "Penalty skipped",
  turnTotal: (points: string) => `Round total ${points}`,
  skippedByHost: "The host skipped this round",
  skippedLeft: (who: string) => `${who} left the room; this round doesn't count`,
  abandoned: "The game ended; this round doesn't count",
  btnNext: "Next round",
  points: (value: number) => `${signed(value)} pt${Math.abs(value) === 1 ? "" : "s"}`,

  staleTurn: "That round is already over",
  notYourTurn: (who: string) => `It's ${who}'s turn`,
  performerOrHost: "Only the player or the host can tap this",
  noRerollsLeft: "No free skips left this game",
  cantVoteSelf: "You can't vote on your own turn",
  lateJoiner: "You joined after the vote opened; you can vote next round",
  votedYes: "You voted pass",
  votedNo: "You voted fail",
  notPlayer: "You're not in the room",
  nothingToSkip: "There's no round to skip right now",

  boardScores: "<b>Scores</b>",
  boardRecent: "<b>Recent rounds</b>",
  boardFooter: "Full log /log",
  boardNoTurns: "The bottle is about to spin",
  boardLeft: "(left)",
  compactChicken: "chicken",
  compactPenalty: "penalty",
  compactSkipped: "skipped",
  logPenalty: "Penalty: ",

  logTitle: (roomId: number, turns: number) => `<b>Truth or Dare ${G.dot} Room #${roomId}</b> ${G.dot} ${count(turns, "round")}`,
  outcome: { pass: `${G.check} passed`, fail: `${G.cross} failed`, chicken: "chickened out", skipped: "skipped" },
  penaltyOutcome: { pass: G.check, fail: G.cross, skipped: "skipped" },
  logRerolled: (skipped: number) => `skipped ${count(skipped, "question")}`,
  logVotes: (yes: number, no: number) => ` ${G.dot} ${yes} : ${no}`,
  logTurnTotal: (points: string, duration: string) => `round ${points} ${G.dot} took ${duration}`,

  summaryTitle: (roomId: number) => `<b>Truth or Dare ${G.dot} Room #${roomId} is over</b>`,
  summaryMeta: (turns: number, duration: string) => `${count(turns, "round")} ${G.dot} ${duration}`,
  rankingTitle: "<b>Ranking</b>",
  rankingLine: (name: string, points: number, truths: number, dares: number, passes: number, turns: number, chickens: number) =>
    `${name}　${signed(points)} pts ${G.dot} truth ${truths} ${G.dot} dare ${dares} ${G.dot} passed ${passes}/${turns}${chickens ? ` ${G.dot} chickened ${chickens}` : ""}`,
  rankingNeverPicked: (name: string, points: number) => `${name}　${signed(points)} pts ${G.dot} never picked this game`,
  highlightsTitle: "<b>Highlights</b>",
  bravest: (name: string, dares: number) => `Bravest　${name} ${G.dot} ${count(dares, "dare")}`,
  mostChicken: (name: string, times: number) => `Biggest chicken　${name} ${G.dot} chickened out ${times === 1 ? "once" : `${times} times`}`,
  penaltyKing: (name: string, penalties: number) => `Penalty regular　${name} ${G.dot} ${count(penalties, "penalty", "penalties")}`,
  longest: (no: number, name: string, duration: string) => `Longest round　#${no} ${name} ${G.dot} ${duration}`,

  statsTitle: (games: number, turns: number) => `<b>Truth or Dare ${G.dot} All-time</b> ${G.dot} ${count(games, "game")}, ${count(turns, "round")}`,
  statsLine: (name: string, points: number, games: number, wins: number, turns: number, darePct: number, passPct: number, chickens: number) =>
    `${name}　${signed(points)} pts ${G.dot} ${count(games, "game")}, ${count(wins, "win")} ${G.dot} ${count(turns, "round")} ${G.dot} dares ${darePct}% ${G.dot} passed ${passPct}%${chickens ? ` ${G.dot} chickened ${chickens}` : ""}`,
  statsLineNeverPicked: (name: string, games: number) => `${name}　0 pts ${G.dot} ${count(games, "game")} ${G.dot} never picked yet`,
  personalTitle: (name: string) => `<b>${name}'s Truth or Dare record</b>`,
  personalTotals: (points: number, games: number, wins: number) => `${signed(points)} pts total ${G.dot} ${count(games, "game")} ${G.dot} ${count(wins, "win")}`,
  personalTurns: (turns: number, truths: number, dares: number) =>
    `Picked ${turns === 1 ? "once" : `${turns} times`} ${G.dot} truth ${truths} ${G.dot} dare ${dares}`,
  personalResults: (passes: number, fails: number, chickens: number, penalties: number, penaltyPasses: number) =>
    `Passed ${passes} ${G.dot} failed ${fails} ${G.dot} chickened ${chickens} ${G.dot} penalties ${penalties} (${penaltyPasses} done)`,
  personalMisc: (rerolls: number, average: string) => `Skipped ${count(rerolls, "question")} ${G.dot} ${average} per round on average`,
  personalNone: (name: string) => `The bottle hasn't picked ${name} yet.`,

  duration: (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },
};

export const todMessages: Record<Lang, TodMessages> = { zh, en };
