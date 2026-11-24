// @ts-check
/**
 * The shell's words, in the chat's language: connecting, the lobby, the end
 * screen. Each game page has its own (games/<id>.js), and notices for a
 * person's taps come from the server already translated. Same rule as the bot:
 * no emoji; icons are the monochrome glyphs ✓ ✗ ● ○ ♛.
 */

/** @typedef {typeof zh} Strings */

const zh = {
  lang: "zh",
  /** Before the room is known, so it can't be the game's name. */
  appTitle: "游戏",
  connecting: "正在连接…",
  reconnecting: "连接断了，正在重连…",
  offline: "还没连上，稍等一下再点",
  errors: {
    openFromGroup: "从群里房间消息上的「打开游戏」进来，才能加入这一局。",
    auth: "登录信息过期了。回群里重新点「打开游戏」。",
    member: "你不在这个群里，进不了这一局。",
    room: "这个房间已经不在了。回群里开一局新的。",
    link: "这个链接不完整。回群里点房间消息上的「打开游戏」。",
    network: "连不上服务器，正在重试…",
    page: "这个游戏的页面没加载出来，正在重试…",
  },

  roomLine: (/** @type {number} */ id, /** @type {number} */ count, /** @type {number} */ max) => `房间 #${id} · ${count}/${max} 人`,
  recruitTitle: "怎么拉人",
  recruitSteps: [
    "回群里点房间消息上的「邀请」选人，或者发 /invite @用户名。对方点「接受」就进来了",
    "也可以让大家点房间消息上的「打开游戏」，在这里点「申请加入」，你点「同意」",
  ],
  recruitFooter: (/** @type {number} */ min, /** @type {number} */ count) => `至少 ${min} 个人才能开始，现在 ${count} 个`,
  players: (/** @type {number} */ count, /** @type {number} */ max) => `玩家 ${count}/${max}`,
  settings: "设置",
  startGame: "开始游戏",
  waitForHost: (/** @type {string} */ host) => `人齐了 ${host} 会开始`,
  notInGame: "点下面的「申请加入」，房主同意后就能一起玩",
  askToJoin: "申请加入",
  asked: "已申请，等房主同意",
  requests: "想加入的人",
  approve: "同意",
  deny: "拒绝",

  watching: "你没在这一局里，只能看",
  gameOver: "这一局结束了",
  nextRoom: "进入新的一局",
};

/** @type {Strings} */
const en = {
  lang: "en",
  appTitle: "Game",
  connecting: "Connecting…",
  reconnecting: "Connection lost, reconnecting…",
  offline: "Not connected yet; try again in a moment",
  errors: {
    openFromGroup: "Open this from the “Open game” button on the room message in your group.",
    auth: "Your login expired. Tap “Open game” in the group again.",
    member: "You're not in this group, so you can't join this game.",
    room: "This room no longer exists. Start a new one in the group.",
    link: "This link is incomplete. Tap “Open game” on the room message in the group.",
    network: "Can't reach the server, retrying…",
    page: "Couldn't load this game's page, retrying…",
  },

  roomLine: (id, count, max) => `Room #${id} · ${count}/${max} players`,
  recruitTitle: "Getting people in",
  recruitSteps: [
    "In the group, tap “Invite” on the room message and pick people, or send /invite @username. They tap “Accept” and they're in",
    "Or have people tap “Open game” on the room message and “Ask to join” here; you tap “Approve”",
  ],
  recruitFooter: (min, count) => `Needs at least ${min} players; ${count} so far`,
  players: (count, max) => `Players ${count}/${max}`,
  settings: "Settings",
  startGame: "Start game",
  waitForHost: (host) => `${host} starts when everyone's in`,
  notInGame: "Tap “Ask to join” below; you're in once the host approves",
  askToJoin: "Ask to join",
  asked: "Asked; waiting for the host",
  requests: "Asking to join",
  approve: "Approve",
  deny: "Deny",

  watching: "You're not in this game; you can watch",
  gameOver: "This game is over",
  nextRoom: "Join the next game",
};

/** @param {string | undefined} lang */
export function stringsFor(lang) {
  return lang === "en" ? en : zh;
}
