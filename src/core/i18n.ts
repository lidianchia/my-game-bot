import { G } from "../ui/glyphs";
import type { EndReason } from "./rooms";

export type Lang = "zh" | "en";

export function parseLang(value: string | null | undefined): Lang | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh") || normalized === "中文" || normalized === "cn") return "zh";
  if (normalized.startsWith("en")) return "en";
  return null;
}

/**
 * Strings shared by every game: rooms, invitations, buttons, alerts.
 * Style rule: no emoji. Hierarchy comes from bold text and middle dots, icons
 * from the monochrome glyphs in ui/glyphs.ts, colour from button styles.
 */
const zh = {
  sep: "、",
  groupOnly: "这个命令要在群里用。",
  privateWelcome: "你好！把我拉进你们的群，在群里发 /play 就能开一局。\n玩法说明：/help",
  groupWelcome: "大家好，我是游戏 bot。\n/play 开一局真心话大冒险，/guess 开一局心照不宣（猜词），玩法说明：/help",
  notAllowed: (chatId: number) =>
    `这个 bot 只给指定的群用。本群 ID：<code>${chatId}</code>\nbot 的主人把这个 ID 加进 ALLOWED_CHAT_IDS 就能用了。`,
  helpCommands:
    "<b>命令</b>\n" +
    "/play 真心话大冒险 · /guess 心照不宣（猜词）\n" +
    "/invite 邀请 · /kick 踢人\n" +
    "/log 本局记录 · /stats 历史统计\n" +
    "/end 结束本局 · /lang 切换语言\n\n" +
    "把 bot 设成群管理员（只给「置顶消息」权限就够），它会自动置顶实时战报。",
  langSwitched: "已切换到中文",
  dmLinked: "已经连上了，回群里继续玩吧。",

  roomAlreadyOpen: "已经有一个房间了，就是这条。",
  noRoom: "现在没有房间，发 /play 开一个。",
  unknownGame: (list: string) => `没有这个游戏。现在可以玩：${list}`,
  roomHeader: (title: string, roomId: number, status: string) => `<b>${title}</b>　房间 #${roomId} ${G.dot} ${status}`,
  statusLobby: "等人中",
  statusPlaying: "进行中",
  statusEnded: "已结束",
  hostLine: (host: string) => `${G.host} 房主 ${host}`,
  playersLine: (count: number, names: string) => `玩家 ${count} 人：${names}`,
  invitedLine: (labels: string) => `等待接受：${labels}`,
  requestedLine: (names: string) => `申请中：${names}`,
  lobbyHint: (min: number) =>
    `房主点「邀请」拉人，对方接受才进；其他人点「申请加入」，房主同意后进。满 ${min} 人就能开始。`,
  roomDisbanded: "这个房间已经解散了。",
  endedLine: (reason: string) => `已结束 ${G.dot} ${reason}`,
  endReason: {
    host: "房主结束",
    admin: "管理员结束",
    idle: "太久没人动",
    empty: "人都走了",
    disbanded: "房主解散",
    migrated: "群升级成了超级群",
    finished: "全部轮完了",
  } satisfies Record<EndReason, string>,

  btnRequestJoin: "申请加入",
  btnLeave: "退出",
  btnInvite: "邀请",
  btnKick: "踢人",
  btnSettings: "设置",
  btnStart: "开始",
  btnDisband: "解散",
  btnSkip: "跳过本轮",
  btnEnd: "结束",
  btnBack: "完成",
  btnConfirmEnd: "确认结束",
  btnConfirmDisband: "确认解散",
  btnCancel: "取消",
  btnAccept: "接受",
  btnDecline: "不去了",
  btnApprove: "同意",
  btnDeny: "拒绝",
  btnSendInvites: (count: number) => `发送邀请 ${G.dot} ${count}`,
  btnKickSelected: (count: number) => `踢出 ${G.dot} ${count}`,
  btnClose: "关闭",
  btnOpenGame: "打开游戏",
  confirmEndPrompt: "确定结束这一局吗？结束后会发本局总结。",
  confirmDisbandPrompt: "确定解散这个房间吗？",
  settingsPrompt: "房主正在改设置，改完点「完成」。",

  hostOnly: "只有房主能这么做",
  hostOrAdminOnly: "只有房主或群管理员可以",
  roomGone: "这个房间已经结束了",
  alreadyIn: "你已经在房间里了",
  notIn: "你不在这个房间里",
  hostCannotLeaveAlone: "你是最后一个人了，要结束的话点「解散」",
  requestAlreadyPending: "已经申请过了，等房主同意",
  requestSent: "已申请，等房主同意",
  joinedViaInvite: "你被邀请过，直接进来了",
  roomFull: (max: number) => `房间满了（最多 ${max} 人）`,
  needMorePlayers: (min: number) => `至少要 ${min} 个人才能开始`,
  gameNotStarted: "游戏还没开始",
  notForYouInvite: "这条邀请不是给你的。想玩的话点房间消息上的「申请加入」",
  alreadyAnswered: "你已经回应过了",
  requestAlreadyDecided: "这个申请已经处理过了",
  nothingSelected: "还没选人",
  staleButton: "这个按钮已经过期了",
  somethingWrong: "出了点问题，再点一次试试",
  webAppMissing:
    "这个游戏在 Mini App 里玩，但 bot 还没配好：先在 BotFather 用 /newapp 建一个，再把短名填进 wrangler.jsonc 的 MINIAPP_SHORT_NAME。",
  ok: "好",

  joinRequestMessage: (who: string, roomId: number, host: string) => `${who} 想加入房间 #${roomId}，${host} 同意吗？`,
  joinRequestApproved: (who: string, roomId: number) => `${G.check} ${who} 加入了房间 #${roomId}`,
  joinRequestDenied: (who: string) => `${G.cross} 房主没有同意 ${who} 的申请`,
  joinRequestExpired: (who: string) => `${who} 的申请已失效`,
  inviteMessage: (host: string, invitees: string, title: string, roomId: number) =>
    `${host} 邀请 ${invitees} 来玩${title} ${G.dot} 房间 #${roomId}`,
  inviteStatus: {
    pending: "还没回应",
    accepted: `${G.check} 来了`,
    declined: `${G.cross} 不来`,
    cancelled: "已失效",
  },
  inviteUsage: "用法：<code>/invite @用户名</code>（可以一次写多个），或者回复某人的消息再发 /invite。",
  inviteNobodyNew: "这些人已经在房间里，或者已经邀请过了。",
  kickUsage: "用法：<code>/kick @用户名</code>，或者回复某人的消息再发 /kick。",
  kickNotPlayer: "这个人不在房间里。",
  pickerInviteTitle:
    "<b>邀请谁？</b>只有房主能选。\n名单里只有 bot 见过的人；不在名单里的，发 <code>/invite @用户名</code>",
  pickerKickTitle: "<b>请谁出去？</b>只有房主能选。",
  pickerEmptyInvite: "名单里没有可以邀请的人。发 /invite @用户名 邀请，或者让对方点「申请加入」。",
  pickerEmptyKick: "除了房主，房间里没有别人。",
  pickerClosed: "（已关闭）",
  pickerInvitesSent: (count: number) => `已邀请 ${count} 人，见下一条。`,
  playerKicked: (who: string) => `${who} 被请出了房间`,
  hostChanged: (who: string) => `${G.host} 房主换成了 ${who}`,
  logEmpty: "还没有记录。",
  statsEmpty: "还没有玩过的记录。",
};

export type CoreMessages = typeof zh;

const en: CoreMessages = {
  sep: ", ",
  groupOnly: "This command only works in a group.",
  privateWelcome: "Hi! Add me to your group and send /play there to start a game.\nHow to play: /help",
  groupWelcome: "Hi everyone, I'm the game bot.\n/play starts Truth or Dare, /guess starts Unsaid (a word game). How to play: /help",
  notAllowed: (chatId: number) =>
    `This bot only plays in approved groups. This group's ID: <code>${chatId}</code>\nThe bot's owner can add it to ALLOWED_CHAT_IDS.`,
  helpCommands:
    "<b>Commands</b>\n" +
    "/play Truth or Dare · /guess Unsaid (word game)\n" +
    "/invite invite · /kick remove\n" +
    "/log this game's log · /stats all-time stats\n" +
    "/end end the game · /lang switch language\n\n" +
    "Make the bot a group admin (only “Pin messages” is needed) and it will pin the live scoreboard.",
  langSwitched: "Switched to English",
  dmLinked: "Connected. Head back to the group to keep playing.",

  roomAlreadyOpen: "There's already a room open: this one.",
  noRoom: "No room is open. Send /play to start one.",
  unknownGame: (list: string) => `Unknown game. Available: ${list}`,
  roomHeader: (title: string, roomId: number, status: string) => `<b>${title}</b>　Room #${roomId} ${G.dot} ${status}`,
  statusLobby: "waiting for players",
  statusPlaying: "in progress",
  statusEnded: "finished",
  hostLine: (host: string) => `${G.host} Host ${host}`,
  playersLine: (count: number, names: string) => `${count} players: ${names}`,
  invitedLine: (labels: string) => `Invited: ${labels}`,
  requestedLine: (names: string) => `Asking to join: ${names}`,
  lobbyHint: (min: number) =>
    `The host taps “Invite” (people must accept); anyone else taps “Ask to join” and waits for the host. Starts with ${min}+ players.`,
  roomDisbanded: "This room was closed.",
  endedLine: (reason: string) => `Finished ${G.dot} ${reason}`,
  endReason: {
    host: "ended by the host",
    admin: "ended by an admin",
    idle: "nobody was playing",
    empty: "everyone left",
    disbanded: "closed by the host",
    migrated: "group was upgraded",
    finished: "all turns played",
  },

  btnRequestJoin: "Ask to join",
  btnLeave: "Leave",
  btnInvite: "Invite",
  btnKick: "Kick",
  btnSettings: "Settings",
  btnStart: "Start",
  btnDisband: "Close room",
  btnSkip: "Skip turn",
  btnEnd: "End game",
  btnBack: "Done",
  btnConfirmEnd: "Yes, end it",
  btnConfirmDisband: "Yes, close it",
  btnCancel: "Cancel",
  btnAccept: "Accept",
  btnDecline: "Decline",
  btnApprove: "Approve",
  btnDeny: "Deny",
  btnSendInvites: (count: number) => `Send invites ${G.dot} ${count}`,
  btnKickSelected: (count: number) => `Kick ${G.dot} ${count}`,
  btnClose: "Close",
  btnOpenGame: "Open game",
  confirmEndPrompt: "End this game? A summary will be posted.",
  confirmDisbandPrompt: "Close this room?",
  settingsPrompt: "The host is changing settings; tap “Done” when finished.",

  hostOnly: "Only the host can do that",
  hostOrAdminOnly: "Only the host or a group admin can do that",
  roomGone: "This room has already finished",
  alreadyIn: "You're already in the room",
  notIn: "You're not in this room",
  hostCannotLeaveAlone: "You're the last one here; tap “Close room” instead",
  requestAlreadyPending: "Already asked; waiting for the host",
  requestSent: "Request sent; waiting for the host",
  joinedViaInvite: "You were invited, so you're in",
  roomFull: (max: number) => `The room is full (max ${max})`,
  needMorePlayers: (min: number) => `Needs at least ${min} players`,
  gameNotStarted: "The game hasn't started yet",
  notForYouInvite: "This invite isn't for you. Tap “Ask to join” on the room message instead",
  alreadyAnswered: "You already answered",
  requestAlreadyDecided: "That request was already handled",
  nothingSelected: "Nobody selected yet",
  staleButton: "That button has expired",
  somethingWrong: "Something went wrong, try again",
  webAppMissing:
    "This game runs in a Mini App that isn't set up yet: create one with /newapp in BotFather, then put its short name in MINIAPP_SHORT_NAME in wrangler.jsonc.",
  ok: "OK",

  joinRequestMessage: (who: string, roomId: number, host: string) => `${who} wants to join room #${roomId}. ${host}, approve?`,
  joinRequestApproved: (who: string, roomId: number) => `${G.check} ${who} joined room #${roomId}`,
  joinRequestDenied: (who: string) => `${G.cross} The host declined ${who}'s request`,
  joinRequestExpired: (who: string) => `${who}'s request expired`,
  inviteMessage: (host: string, invitees: string, title: string, roomId: number) =>
    `${host} invites ${invitees} to play ${title} ${G.dot} Room #${roomId}`,
  inviteStatus: {
    pending: "no answer yet",
    accepted: `${G.check} joined`,
    declined: `${G.cross} declined`,
    cancelled: "expired",
  },
  inviteUsage: "Usage: <code>/invite @username</code> (several at once is fine), or reply to someone's message with /invite.",
  inviteNobodyNew: "Those people are already in the room or already invited.",
  kickUsage: "Usage: <code>/kick @username</code>, or reply to someone's message with /kick.",
  kickNotPlayer: "That person isn't in the room.",
  pickerInviteTitle:
    "<b>Invite whom?</b> Host only.\nOnly people the bot has seen are listed; for anyone else send <code>/invite @username</code>",
  pickerKickTitle: "<b>Remove whom?</b> Host only.",
  pickerEmptyInvite: "Nobody to list yet. Send /invite @username, or ask them to tap “Ask to join”.",
  pickerEmptyKick: "There's nobody besides the host.",
  pickerClosed: "(closed)",
  pickerInvitesSent: (count: number) => `Invited ${count}, see below.`,
  playerKicked: (who: string) => `${who} was removed from the room`,
  hostChanged: (who: string) => `${G.host} ${who} is now the host`,
  logEmpty: "Nothing logged yet.",
  statsEmpty: "No games played yet.",
};

export const coreMessages: Record<Lang, CoreMessages> = { zh, en };
