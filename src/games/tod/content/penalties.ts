import type { Card } from "./types";

/**
 * Drawn after someone chickens out or loses the vote. They cannot chicken
 * out of these, so each one stays harsher than a normal dare but still doable.
 */
export const PENALTIES: Card[] = [
  // ---------------------------------------------------------------- 😇 mild
  { id: "p1-01", level: 1, type: "post", zh: "把群昵称改成「我是胆小鬼」，保持到游戏结束。", en: "Change your group nickname to \"Scaredy-cat\" until the game ends." },
  { id: "p1-02", level: 1, type: "post", zh: "发一张你最丑的照片，配文「这是我最美的一张」。", en: "Post your ugliest photo with the caption \"my best photo ever\"." },
  { id: "p1-03", level: 1, type: "post", zh: "在群里连发 10 条「我错了」。", en: "Send \"I was wrong\" in the group 10 times in a row." },
  { id: "p1-04", level: 1, type: "contact", zh: "给家里人发「我刚刚做了一件特别蠢的事」，截图回复。", en: "Text a family member \"I just did something really dumb\" and screenshot the reply." },
  { id: "p1-05", level: 1, type: "voice", zh: "唱一段至少 10 秒的道歉歌。", en: "Sing an apology to the group for at least 10 seconds." },
  { id: "p1-06", level: 1, type: "post", zh: "让群友挑一张表情包，你拿它当头像，挂一个小时。", en: "Let the group pick a meme for your profile photo, and keep it for an hour." },
  { id: "p1-07", level: 1, type: "contact", zh: "发一条动态：「今天玩游戏输了，求安慰」，挂 30 分钟。", en: "Post \"Lost a game today, please comfort me\" to your story for 30 minutes." },
  { id: "p1-08", level: 1, type: "voice", zh: "接下来 3 轮，你每句话结尾都要加一个「喵」。", en: "For the next 3 rounds, end every sentence with \"meow\"." },
  { id: "p1-09", level: 1, type: "post", zh: "把你最近 10 条搜索记录截图发群里。", en: "Post a screenshot of your last 10 searches." },
  { id: "p1-10", level: 1, type: "contact", zh: "给通讯录里第一个联系人发「你是我的偶像」，截图回复。", en: "Text the first person in your contacts \"You're my idol\" and screenshot the reply." },

  // ---------------------------------------------------------------- 😏 spicy
  { id: "p2-01", level: 2, type: "post", zh: "在群里发一条 30 秒的语音，向群友指定的一个人深情表白。", en: "Send the group a 30-second voice message confessing your love to someone the group picks." },
  { id: "p2-02", level: 2, type: "contact", zh: "给前任发「我后悔了」，截图回复（没有前任就发给最近的暧昧对象）。", en: "Text your ex \"I regret it\" (or your latest crush) and screenshot the reply." },
  { id: "p2-03", level: 2, type: "post", zh: "头像换成群友指定的一张照片，挂 24 小时。", en: "Use a profile photo the group picks for 24 hours." },
  { id: "p2-04", level: 2, type: "contact", zh: "让群友帮你写一条动态，你原样发出去，挂 1 小时。", en: "Let the group write a post for your story; publish it word for word for an hour." },
  { id: "p2-05", level: 2, type: "post", zh: "把你这个月的消费记录截图发群里，金额可以打码。", en: "Post a screenshot of this month's spending. You can blur the amounts." },
  { id: "p2-06", level: 2, type: "contact", zh: "给老板或老师发「谢谢您一直以来的照顾❤️」，截图回复。", en: "Text your boss or teacher \"Thank you for always looking out for me ❤️\" and screenshot the reply." },
  { id: "p2-07", level: 2, type: "post", zh: "把相册里最尴尬的一张照片发群里，10 分钟内不许撤回。", en: "Post the most embarrassing photo in your camera roll and don't unsend it for 10 minutes." },
  { id: "p2-08", level: 2, type: "contact", zh: "给通讯录里最新加的人发「你不觉得我们很有缘吗？」，截图回复。", en: "Text your newest contact \"Don't you think we were meant to meet?\" and screenshot the reply." },
  { id: "p2-09", level: 2, type: "voice", zh: "用最肉麻的语气，给群里每个人各说一句情话。", en: "Say a sappy love line to every person in the group, in your gooiest voice." },
  { id: "p2-10", level: 2, type: "post", zh: "把个性签名改成群友指定的一句话，保持 3 天。", en: "Change your bio to a line the group picks, for 3 days." },

  // ---------------------------------------------------------------- 🌶️ 18+
  { id: "p3-01", level: 3, type: "contact", zh: "给前任发「你还记得我们的第一次吗？」，截图回复。", en: "Text your ex \"Do you remember our first time?\" and screenshot the reply." },
  { id: "p3-02", level: 3, type: "contact", zh: "发一张性感自拍到动态，配文由群友决定，挂 1 小时。", en: "Post a sexy selfie to your story with a caption the group writes, for an hour." },
  { id: "p3-03", level: 3, type: "post", zh: "把你和最近一个暧昧对象的聊天记录截 3 张发群里，可以打码。", en: "Post 3 screenshots of your chat with your latest situationship. Blur if needed." },
  { id: "p3-04", level: 3, type: "contact", zh: "给通讯录里你最不熟的一个人发「今晚想见你」，截图回复。", en: "Text the contact you know least \"I want to see you tonight\" and screenshot the reply." },
  { id: "p3-05", level: 3, type: "voice", zh: "在群里发一条语音，用最撩人的声音念群友指定的一段话。", en: "Send a voice message reading a line the group picks, in your most seductive voice." },
  { id: "p3-06", level: 3, type: "post", zh: "把头像换成一张写着「求包养」的图，挂 1 小时。", en: "Make your profile photo an image that says \"Looking for a sugar daddy/mommy\" for an hour." },
  { id: "p3-07", level: 3, type: "contact", zh: "给你的暗恋对象发「其实我喜欢你很久了」，截图回复。", en: "Text your crush \"I've actually liked you for a long time\" and screenshot the reply." },
  { id: "p3-08", level: 3, type: "post", zh: "群友说一个 1 到 100 的数字，你把相册里对应那张照片发出来，不许拒绝。", en: "The group names a number from 1 to 100; post that photo from your camera roll. No refusing." },
  { id: "p3-09", level: 3, type: "contact", zh: "给前任最新一条动态点赞，并评论「好看」。", en: "Like your ex's latest post and comment \"looking good\"." },
  { id: "p3-10", level: 3, type: "voice", zh: "用你最性感的声音，讲一个 30 秒的成人笑话。", en: "Tell a 30-second dirty joke in your sexiest voice." },
];
