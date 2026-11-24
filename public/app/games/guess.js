// @ts-check
/** @typedef {import("../../../src/web/protocol").WebPerson} WebPerson */
/** @typedef {import("../../../src/games/guess/view-types").GuessView} GuessView */
/** @typedef {import("../../../src/games/guess/view-types").TabooView} TabooView */
/** @typedef {import("../../../src/games/guess/view-types").UniqueView} UniqueView */
/** @typedef {import("../../../src/games/guess/view-types").Points} Points */
/** @typedef {import("../screens.js").Part} Part */
/** @typedef {import("../screens.js").Action} Action */
/** @typedef {import("../screens.js").GameCtx<GuessView>} Ctx */
/** @typedef {import("../screens.js").GameCtx<GuessView | null>} RoomCtx */
/** @typedef {import("../ui.js").Child} Child */

import { avatar, banner, cell, crew, delta, group, h, icon, note, pill, ring, score, scoreStrip, title, waitCard } from "../ui.js";

/**
 * 心照不宣 / Unsaid in the game page; the server half is src/games/guess, and
 * its styles are in guess.css. The shell (../main.js) has logged in and draws
 * the lobby and the end screen; this draws the game in between.
 */

/**
 * What just changed, for one-off animations on the draw right after it (what `react` returns).
 * @typedef {object} Fx
 * @property {number} fresh   new lines at the top of the guess feed
 * @property {"hit" | "foul" | null} flash   a word was just guessed / a foul was just called
 */

/** @type {Fx} */
const NO_FX = { fresh: 0, flash: null };

/** The Unique Clues turn whose card flips over when drawn; set when that turn's result comes in. */
let revealTurn = -1;

// ------------------------------------------------------------------ words

const zh = {
  turnOf: (/** @type {number} */ no, /** @type {number} */ total) => `第 ${no}/${total} 轮`,
  modes: { taboo: "禁词", unique: "别撞车" },

  // The lobby's guide. Points here must match POINTS in src/games/guess/types.ts (test/unit/page.test.ts checks).
  howTitle: "怎么玩",
  howTurns: { title: "轮流当主角", text: "每人轮流当主角，轮完自动结束，总结发在群里" },
  howModes: {
    taboo:
      "主角看到一个词和 4 个禁用词，在群语音里描述（也可以打字提示），不能说出这个词和禁用词。其他人在这里打字猜：猜中一个，猜的人和主角各 +1；主角说漏了，大家点「犯规」，主角 −1",
    unique:
      "这次主角来猜。其他人都看得到词，每人写一个词当线索：写得一样的互相抵消，意思太像的大家划掉。主角只看得到剩下的线索，猜一次：猜对了主角 +2，线索留下来的人各 +1",
  },

  scores: "比分",
  onlyLeadSees: (/** @type {string} */ name) => `只有 ${name} 看得到词`,
  onlyYou: "只有你看得到",
  hiddenFrom: (/** @type {string} */ name) => `${name} 看不到`,
  offLimits: "禁用词",

  // Off-limits
  yourTurnToDescribe: "轮到你描述了",
  describeRules: (/** @type {number} */ seconds) =>
    `点「开始」后有 ${seconds} 秒。在语音里描述，不能说出这个词和它的禁用词，也可以在下面打字提示。`,
  begin: "开始",
  readyToDescribe: (/** @type {string} */ name) => `${name} 准备描述`,
  guessHowTo: "开始后在下面打字猜。描述的人说出了禁用词，就点「犯规」。",
  foulHowTo: "描述的人说出了禁用词，就点「犯规」",
  describing: (/** @type {string} */ name) => `${name} 在描述`,
  describeHowTo: "猜中就换下一个。不好描述就跳过。",
  skipWord: "跳过这个",
  foul: "犯规",
  hintPlaceholder: "打字提示（可选）",
  guessPlaceholder: "你猜是…",
  send: "发送",
  guess: "猜",
  feedEmpty: "大家猜的词会出现在这里",
  feedHint: "提示",
  feedCorrect: "猜中",
  feedSkip: "跳过",
  feedBuzz: "喊犯规",
  feedSlip: "打出了禁用词",
  outcomes: { guessed: "猜中", skipped: "跳过", buzzed: "犯规", slipped: "说漏", timeout: "没猜完" },
  wordsGuessed: (/** @type {number} */ count) => `猜中 ${count} 个`,

  // Unique Clues
  writeFor: (/** @type {string} */ name) => `给 ${name} 写一条线索`,
  writeRules: "只写一个词。和别人写得一样的会互相抵消，也不能带上答案里的字。",
  cluePlaceholder: "一个词",
  write: "写好了",
  yourClue: "你写的",
  canChange: "时间到之前可以改",
  wrote: (/** @type {number} */ done, /** @type {number} */ total) => `${done}/${total} 人写好了`,
  othersWriting: "大家在给你写线索",
  othersReviewing: "大家在检查线索",
  leadWaitHint: "线索准备好就轮到你猜。",
  reviewTitle: "检查线索",
  reviewRules: "撞车和露底的已经去掉了。意思一样的点一下划掉，再点一下恢复。",
  reviewed: "检查好了",
  confirmed: (/** @type {number} */ done, /** @type {number} */ total) => `${done}/${total} 人检查好了`,
  removed: { duplicate: "撞车", answer: "露底", struck: "划掉" },
  yourGuess: "轮到你猜了",
  oneTry: "只有一次机会。",
  giveUp: "不猜了",
  waitForGuess: (/** @type {string} */ name) => `等 ${name} 猜`,
  noCluesLeft: "一条线索都没剩下",
  guessedAs: (/** @type {string} */ name, /** @type {string} */ guess) => `${name} 猜「${guess}」`,
  uniqueOutcomes: { correct: "猜对了", wrong: "猜错了", passed: "没有猜", timeout: "时间到了" },
  ruledRight: "房主判对了",
  ruleRight: "算对",
  answer: "答案",

  // End of a turn / the game
  turnOver: "这一轮结束",
  skipReasons: { host: "房主跳过了这一轮", left: "主角离开了", idle: "描述的人没点开始", ended: "游戏提前结束了" },
  turnPoints: "这一轮得分",
  noPoints: "这一轮没人得分",
  nextTurn: "下一轮",
  finish: "结束，看总结",
  finalScores: "最终比分",
  summaryInGroup: "总结发在群里了。",
};

/** @typedef {typeof zh} Strings */

/** @type {Strings} */
const en = {
  turnOf: (no, total) => `Turn ${no}/${total}`,
  modes: { taboo: "Off-limits", unique: "Unique Clues" },

  howTitle: "How to play",
  howTurns: { title: "Take turns leading", text: "Everyone takes a turn as the lead; the game ends itself and posts a summary in the group" },
  howModes: {
    taboo:
      "The lead sees a word and 4 off-limits words and describes it in the group's voice chat (typed hints work too) without saying any of them. Everyone else types guesses here: each word guessed is +1 for the guesser and the lead. If the lead slips, tap “Foul”: −1 for the lead",
    unique:
      "This time the lead guesses. Everyone else sees the word and writes a one-word clue; matching clues cancel out, and you strike ones that mean the same. The lead sees only the clues left and gets one guess: +2 if right, and +1 to each writer whose clue survived",
  },

  scores: "Scores",
  onlyLeadSees: (name) => `Only ${name} can see the word`,
  onlyYou: "Only you can see this",
  hiddenFrom: (name) => `Hidden from ${name}`,
  offLimits: "Off-limits words",

  yourTurnToDescribe: "Your turn to describe",
  describeRules: (seconds) =>
    `You get ${seconds}s after you tap Start. Describe it in voice chat without saying the word or any of its off-limits words. You can also type hints below.`,
  begin: "Start",
  readyToDescribe: (name) => `${name} is about to describe`,
  guessHowTo: "Type guesses below once it starts. If they say an off-limits word, tap “Foul”.",
  foulHowTo: "If they say an off-limits word, tap “Foul”",
  describing: (name) => `${name} is describing`,
  describeHowTo: "A correct guess deals the next word. Skip any word that's too hard.",
  skipWord: "Skip this one",
  foul: "Foul",
  hintPlaceholder: "Type a hint (optional)",
  guessPlaceholder: "Your guess…",
  send: "Send",
  guess: "Guess",
  feedEmpty: "Guesses show up here",
  feedHint: "hint",
  feedCorrect: "got it",
  feedSkip: "skipped",
  feedBuzz: "called a foul",
  feedSlip: "typed an off-limits word",
  outcomes: { guessed: "guessed", skipped: "skipped", buzzed: "foul", slipped: "slipped", timeout: "time up" },
  wordsGuessed: (count) => `${count} guessed`,

  writeFor: (name) => `Write a clue for ${name}`,
  writeRules: "One word only. Clues that match someone else's cancel out, and none may contain the answer.",
  cluePlaceholder: "One word",
  write: "Done",
  yourClue: "Your clue",
  canChange: "You can change it until time's up",
  wrote: (done, total) => `${done}/${total} written`,
  othersWriting: "Everyone is writing clues for you",
  othersReviewing: "Everyone is checking the clues",
  leadWaitHint: "You'll guess as soon as the clues are ready.",
  reviewTitle: "Check the clues",
  reviewRules: "Clashes and giveaways are already out. Tap any that mean the same thing to strike them; tap again to undo.",
  reviewed: "Looks good",
  confirmed: (done, total) => `${done}/${total} done checking`,
  removed: { duplicate: "clash", answer: "gives it away", struck: "struck" },
  yourGuess: "Your guess",
  oneTry: "You get one try.",
  giveUp: "Pass",
  waitForGuess: (name) => `Waiting for ${name} to guess`,
  noCluesLeft: "No clues survived",
  guessedAs: (name, guess) => `${name} guessed “${guess}”`,
  uniqueOutcomes: { correct: "Right", wrong: "Wrong", passed: "Passed", timeout: "Time's up" },
  ruledRight: "The host ruled it right",
  ruleRight: "Count it",
  answer: "Answer",

  turnOver: "Turn over",
  skipReasons: { host: "The host skipped this turn", left: "The lead left", idle: "The describer never started", ended: "The game ended early" },
  turnPoints: "Points this turn",
  noPoints: "Nobody scored this turn",
  nextTurn: "Next turn",
  finish: "Finish and see the summary",
  finalScores: "Final scores",
  summaryInGroup: "The summary is in the group.",
};

/** @param {string} lang */
const stringsFor = (lang) => (lang === "en" ? en : zh);

// ---------------------------------------------------------------- pieces

/**
 * Mode, turn and the clock, in one line at the top.
 * @param {Strings} t
 * @param {GuessView} game
 * @param {TabooView | UniqueView} turn
 */
function hud(t, game, turn) {
  // Before the describer presses Start, the clock is only a safety net for an absent describer: don't show it as the turn's clock.
  const timed = turn.endsAt !== null && !(turn.mode === "taboo" && turn.phase === "ready");
  return h(
    "div",
    { class: "hud" },
    h("span", { class: "tint" }, t.modes[turn.mode]),
    h("span", { class: "hud-round" }, t.turnOf(game.progress.no, game.progress.total)),
    timed && turn.endsAt !== null ? ring(turn.endsAt, turn.span) : null,
  );
}

/**
 * The card as everyone but its holder sees it: who has it, and that it's hidden.
 * @param {WebPerson} lead
 * @param {string} heading
 * @param {string} hint
 * @param {Fx["flash"]} [flash]
 */
function leadCard(lead, heading, hint, flash = null) {
  return h(
    "section",
    { class: `lead-card${flash === "foul" ? " flash-foul" : ""}` },
    avatar(lead, 48),
    h("div", { class: "lead-text" }, h("p", { class: "lead-title" }, heading), h("p", { class: "lead-note" }, icon("hidden"), h("span", null, hint))),
  );
}

/**
 * The face of the word card: the word and its off-limits words.
 * @param {string} word
 * @param {string[]} taboo
 * @param {Strings} t
 * @param {{ caption: string, secret?: boolean, reveal?: boolean, small?: boolean, flash?: Fx["flash"] }} options
 */
function wordCard(word, taboo, t, options) {
  const classes = ["card"];
  if (options.reveal) classes.push("reveal");
  if (options.small) classes.push("small");
  if (options.flash === "hit") classes.push("deal");
  if (options.flash === "foul") classes.push("flash-foul");
  return h(
    "section",
    { class: classes.join(" "), "aria-label": options.caption },
    h("p", { class: "card-caption" }, options.secret ? icon("hidden") : null, h("span", null, options.caption)),
    h("p", { class: "card-word", lang: "" }, word),
    taboo.length ? h("ul", { class: "taboo", "aria-label": t.offLimits }, taboo.map((term) => h("li", null, icon("ban"), h("span", null, term)))) : null,
  );
}

/**
 * @param {Points[]} points
 * @param {Strings} t
 */
function pointsGroup(points, t) {
  if (points.length === 0) return note(t.noPoints);
  return group(
    t.turnPoints,
    h(
      "ul",
      { class: "section" },
      points.map((entry) =>
        cell({
          before: avatar(entry, 28),
          title: entry.name,
          after: h("span", { class: `cell-after points ${entry.points < 0 ? "minus" : "plus"}` }, delta(entry.points)),
        }),
      ),
    ),
  );
}

/**
 * "Next turn" / "Finish", for anyone in the game.
 * @param {Ctx} ctx
 * @param {Strings} t
 * @returns {Action | null}
 */
function nextAction(ctx, t) {
  const { view, game } = ctx;
  if (!view.me.isPlayer && !view.me.isHost) return null;
  return { label: game.last ? t.finish : t.nextTurn, onClick: () => ctx.send({ a: "g", op: "next" }) };
}

// ------------------------------------------------------------ Off-limits

/**
 * @param {TabooView["feed"][number]} item
 * @param {Strings} t
 * @param {boolean} enter  just arrived: slide it in
 */
function feedRow(item, t, enter) {
  /** @type {Child} */
  let said = item.text;
  /** @type {string | null} */
  let tag = null;
  /** @type {string | null} */
  let mark = null;
  let tone = "";
  switch (item.kind) {
    case "guess":
      mark = "✗";
      break;
    case "correct":
      tone = "hit";
      said = item.word ?? item.text;
      mark = `✓ ${t.feedCorrect}`;
      break;
    case "hint":
      tone = "hint";
      tag = t.feedHint;
      break;
    case "skip":
      tone = "out";
      tag = t.feedSkip;
      said = h("s", null, item.word ?? "");
      break;
    case "buzz":
      tone = "foul";
      tag = t.feedBuzz;
      said = h("s", null, item.word ?? "");
      break;
    case "slip":
      tone = "foul";
      tag = t.feedSlip;
      break;
  }
  return h(
    "li",
    { class: `feed-row${tone ? ` ${tone}` : ""}${enter ? " enter" : ""}` },
    avatar({ id: item.whoId, name: item.who }, 28),
    h("span", { class: "who" }, item.who),
    h("span", { class: "said" }, tag ? h("span", { class: "tag" }, tag) : null, said),
    mark ? h("span", { class: "mark" }, mark) : null,
  );
}

/**
 * Newest first.
 * @param {TabooView} turn
 * @param {Strings} t
 * @param {number} fresh  how many of the newest lines just arrived
 */
function feed(turn, t, fresh) {
  if (turn.feed.length === 0) return note(t.feedEmpty);
  return h(
    "ol",
    { class: "section feed", "aria-live": "polite" },
    [...turn.feed].reverse().map((item, index) => feedRow(item, t, index < fresh)),
  );
}

/**
 * @param {Ctx} ctx
 * @param {Strings} t
 * @param {Fx} fx
 * @param {TabooView} turn
 * @returns {Part}
 */
function tabooScreen(ctx, t, fx, turn) {
  const { game, send } = ctx;
  const act = (/** @type {Record<string, unknown>} */ fields) => send({ a: "g", op: String(fields.op), turn: turn.no, ...fields });
  const isLead = turn.role === "lead";
  const lead = turn.lead;

  if (turn.phase === "ready") {
    if (isLead) {
      return {
        body: [title(t.yourTurnToDescribe), note(t.describeRules(game.settings.seconds))],
        main: { label: t.begin, onClick: () => act({ op: "begin" }) },
      };
    }
    return {
      body: [leadCard(lead, t.readyToDescribe(lead.name), t.onlyLeadSees(lead.name)), turn.role === "player" ? note(t.guessHowTo) : null],
    };
  }

  if (turn.phase === "describing" && turn.card) {
    const ref = turn.card.ref;
    const guessed = turn.results.filter((result) => result.outcome === "guessed").length;
    const tally = h("span", { class: `tint tint-go${fx.flash === "hit" ? " pop" : ""}` }, t.wordsGuessed(guessed));
    if (isLead && turn.card.word) {
      return {
        body: [
          wordCard(turn.card.word, turn.card.taboo, t, { caption: t.onlyYou, secret: true, flash: fx.flash }),
          h("div", { class: "row" }, tally, pill(t.skipWord, () => act({ op: "skip", card: ref }))),
          note(t.describeHowTo),
          feed(turn, t, fx.fresh),
        ],
        composer: {
          key: `hint:${turn.no}`,
          placeholder: t.hintPlaceholder,
          button: t.send,
          maxLength: 80,
          toMessage: (text) => ({ a: "g", op: "hint", turn: turn.no, card: ref, text }),
        },
      };
    }
    const player = turn.role === "player";
    return {
      body: [
        leadCard(lead, t.describing(lead.name), t.onlyLeadSees(lead.name), fx.flash),
        player ? h("div", { class: "row" }, tally, pill(t.foul, () => act({ op: "buzz", card: ref }), "destructive")) : null,
        player ? note(t.foulHowTo) : null,
        feed(turn, t, fx.fresh),
      ],
      composer: player
        ? {
            key: `guess:${turn.no}`,
            placeholder: t.guessPlaceholder,
            button: t.guess,
            maxLength: 40,
            toMessage: (text) => ({ a: "g", op: "guess", turn: turn.no, card: ref, text }),
          }
        : null,
    };
  }

  // Turn over: every word with what happened to it.
  return {
    body: [
      title(t.turnOver),
      turn.skipReason ? note(t.skipReasons[turn.skipReason]) : null,
      turn.results.length
        ? h(
            "ul",
            { class: "section" },
            turn.results.map((result) =>
              cell({
                cls: `result ${result.outcome}`,
                title: result.outcome === "guessed" ? result.word : h("s", null, result.word),
                after: result.outcome === "guessed" ? `✓ ${result.by ?? ""}` : t.outcomes[result.outcome],
              }),
            ),
          )
        : null,
      pointsGroup(turn.points, t),
    ],
    main: nextAction(ctx, t),
  };
}

// ---------------------------------------------------------- Unique Clues

/**
 * @param {Ctx} ctx
 * @param {Strings} t
 * @param {UniqueView} turn
 * @param {boolean} interactive  writers may strike clues during the review
 */
function clueSlips(ctx, t, turn, interactive) {
  if (!turn.clues || turn.clues.length === 0) return note(t.noCluesLeft);
  return h(
    "ul",
    { class: "slips" },
    turn.clues.map((clue) => {
      const out = clue.removed !== null;
      const canToggle = interactive && (clue.removed === null || clue.removed === "struck");
      const content = [
        out ? h("s", { class: "slip-text" }, clue.text) : h("span", { class: "slip-text" }, clue.text),
        h("span", { class: "slip-meta" }, clue.removed ? t.removed[clue.removed] : clue.name),
      ];
      if (!canToggle) return h("li", { class: `slip${out ? " out" : ""}` }, ...content);
      return h(
        "li",
        null,
        h(
          "button",
          {
            type: "button",
            class: `slip slip-toggle${out ? " out" : ""}${clue.struckByMe ? " mine" : ""}`,
            "aria-pressed": clue.struckByMe ? "true" : "false",
            onclick: () => ctx.send({ a: "g", op: "strike", turn: turn.no, writer: clue.writer }),
          },
          ...content,
        ),
      );
    }),
  );
}

/**
 * @param {Ctx} ctx
 * @param {Strings} t
 * @param {UniqueView} turn
 * @returns {Part}
 */
function uniqueScreen(ctx, t, turn) {
  const { view } = ctx;
  const act = (/** @type {Record<string, unknown>} */ fields) => ctx.send({ a: "g", op: String(fields.op), turn: turn.no, ...fields });
  const lead = turn.lead.name;
  const wroteCount = turn.writers.filter((writer) => writer.wrote).length;
  const confirmedCount = turn.writers.filter((writer) => writer.confirmed).length;
  const wrote = () => crew(turn.writers, (w) => w.wrote, t.wrote(wroteCount, turn.writers.length));
  const checked = () => crew(turn.writers, (w) => w.confirmed, t.confirmed(confirmedCount, turn.writers.length));
  const face = (/** @type {{ reveal?: boolean, small?: boolean }} */ options = {}) =>
    turn.word
      ? wordCard(turn.word, [], t, {
          caption: turn.phase === "done" ? t.answer : t.hiddenFrom(lead),
          secret: turn.phase !== "done",
          reveal: options.reveal,
          small: options.small,
        })
      : null;

  if (turn.phase === "writing") {
    if (turn.role === "lead") return { body: [waitCard(t.othersWriting, t.leadWaitHint), wrote()] };
    const writer = turn.role === "writer";
    return {
      body: [
        face(),
        writer ? title(t.writeFor(lead)) : null,
        writer ? note(t.writeRules) : null,
        writer && turn.myClue
          ? h("p", { class: "my-clue" }, h("span", { class: "note" }, `${t.yourClue} `), h("strong", null, turn.myClue), h("span", { class: "note" }, ` ${t.canChange}`))
          : null,
        wrote(),
      ],
      composer: writer
        ? {
            key: `clue:${turn.no}`,
            placeholder: t.cluePlaceholder,
            button: t.write,
            maxLength: 20,
            toMessage: (text) => ({ a: "g", op: "clue", turn: turn.no, text }),
          }
        : null,
    };
  }

  if (turn.phase === "reviewing") {
    if (turn.role === "lead") return { body: [waitCard(t.othersReviewing, null), checked()] };
    const writer = turn.role === "writer";
    const mine = turn.writers.find((w) => w.id === view.me.id);
    return {
      body: [face({ small: true }), title(t.reviewTitle), note(t.reviewRules), clueSlips(ctx, t, turn, writer), checked()],
      main: writer && !mine?.confirmed ? { label: t.reviewed, kind: "go", onClick: () => act({ op: "confirm" }) } : null,
    };
  }

  if (turn.phase === "guessing") {
    if (turn.role === "lead") {
      return {
        body: [
          title(t.yourGuess),
          note(t.oneTry),
          clueSlips(ctx, t, turn, false),
          h("div", { class: "row end" }, pill(t.giveUp, () => act({ op: "pass" }))),
        ],
        composer: {
          key: `uguess:${turn.no}`,
          placeholder: t.guessPlaceholder,
          button: t.guess,
          maxLength: 40,
          toMessage: (text) => ({ a: "g", op: "guess", turn: turn.no, text }),
        },
      };
    }
    return { body: [face({ small: true }), title(t.waitForGuess(lead)), clueSlips(ctx, t, turn, false)] };
  }

  // Turn over: the card turns over for the guesser, everyone sees how it went.
  const outcome = turn.outcome;
  const tone = outcome === "correct" ? " right" : outcome === "wrong" ? " wrong" : "";
  return {
    body: [
      face({ reveal: revealTurn === turn.no }),
      outcome
        ? h(
            "div",
            { class: `verdict${tone}` },
            h("strong", null, `${outcome === "correct" ? "✓ " : outcome === "wrong" ? "✗ " : ""}${t.uniqueOutcomes[outcome]}`),
            turn.guess !== null ? h("span", null, t.guessedAs(lead, turn.guess)) : null,
          )
        : null,
      turn.accepted ? note(t.ruledRight) : null,
      turn.skipReason ? note(t.skipReasons[turn.skipReason]) : null,
      clueSlips(ctx, t, turn, false),
      pointsGroup(turn.points, t),
    ],
    main: nextAction(ctx, t),
    secondary:
      view.me.isHost && outcome === "wrong" && !turn.accepted
        ? { label: t.ruleRight, kind: "go", onClick: () => ctx.send({ a: "g", op: "accept" }) }
        : null,
  };
}

// ------------------------------------------------------ lobby and the end

/**
 * The rules, for the modes this game will actually play.
 * @param {RoomCtx} ctx
 */
function howToPlay(ctx) {
  const { view } = ctx;
  const t = stringsFor(view.lang);
  const picked = view.room.options.find((row) => row.key === "m")?.options.find((option) => option.on)?.value;
  /** @type {Array<"taboo" | "unique">} */
  const modes = picked === "taboo" ? ["taboo"] : picked === "unique" ? ["unique"] : ["taboo", "unique"];
  const rule = (/** @type {string} */ tone, /** @type {string} */ heading, /** @type {string} */ text) =>
    cell({ cls: `how how-${tone}`, before: h("i", { class: "how-dot" }), title: heading, sub: text });
  return group(
    t.howTitle,
    h("ul", { class: "section" }, rule("turns", t.howTurns.title, t.howTurns.text), modes.map((mode) => rule(mode, t.modes[mode], t.howModes[mode]))),
  );
}

/** @param {RoomCtx} ctx */
function finalScores(ctx) {
  const { view, game } = ctx;
  const t = stringsFor(view.lang);
  if (!game || game.scores.length === 0) return null;
  return group(
    t.finalScores,
    h(
      "ol",
      { class: "section final" },
      game.scores.map((entry, index) =>
        cell({
          cls: entry.id === view.me.id ? "is-me" : "",
          before: [h("span", { class: "rank" }, String(index + 1)), avatar(entry, 32)],
          title: entry.name,
          after: h("span", { class: "cell-after final-score" }, score(entry.score)),
        }),
      ),
    ),
    t.summaryInGroup,
  );
}

// ------------------------------------------------------------------ page

/** @type {import("../screens.js").GamePage<GuessView>} */
const page = {
  strings: { zh, en },
  styles: true,

  play(ctx) {
    const { view, game, ui } = ctx;
    const t = stringsFor(view.lang);
    const turn = game.turn;
    if (!turn) return { body: [note(ui.connecting)] };
    const fx = /** @type {Fx | null} */ (ctx.fx) ?? NO_FX;
    const part = turn.mode === "taboo" ? tabooScreen(ctx, t, fx, turn) : uniqueScreen(ctx, t, turn);
    const watching = !view.me.isPlayer && turn.phase !== "done" ? banner(ui.watching) : null;
    return {
      ...part,
      title: `${view.room.title} · ${t.turnOf(game.progress.no, game.progress.total)}`,
      mode: turn.mode,
      body: [hud(t, game, turn), scoreStrip(game.scores, { me: view.me.id, lead: turn.lead.id, label: t.scores }), watching, ...part.body],
    };
  },

  lobby: (ctx) => [howToPlay(ctx)],
  ended: (ctx) => [finalScores(ctx)],

  /** A buzz in the hand when something happens to you or your guess; a fresh guess or foul animates once. */
  react(before, after, { me, haptics }) {
    const previous = before?.turn ?? null;
    const turn = after?.turn ?? null;
    if (!turn) return null;
    const newTurn = !previous || previous.no !== turn.no;
    /** @type {Fx | null} */
    let fx = null;

    if (newTurn && turn.lead.id === me.id) haptics?.impactOccurred("heavy");
    if (turn.mode === "taboo" && previous?.mode === "taboo" && !newTurn) {
      const fresh = turn.feed.slice(previous.feed.length);
      /** @type {Fx["flash"]} */
      let flash = null;
      if (fresh.some((item) => item.kind === "correct")) flash = "hit";
      else if (fresh.some((item) => item.kind === "buzz" || item.kind === "slip")) flash = "foul";
      if (flash) haptics?.notificationOccurred(flash === "hit" ? "success" : "error");
      fx = { fresh: fresh.length, flash };
    }
    if (turn.mode === "unique" && turn.phase === "done" && (newTurn || previous?.phase !== "done")) {
      revealTurn = turn.no; // flip the card over once
      if (turn.outcome === "correct") haptics?.notificationOccurred("success");
      else if (turn.outcome === "wrong") haptics?.notificationOccurred("error");
    } else if (turn.phase !== "done") {
      revealTurn = -1;
    }
    return fx;
  },
};

export default page;
