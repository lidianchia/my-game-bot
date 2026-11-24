// @ts-check
/** @typedef {import("../../../src/games/_template/view-types").HiLoView} HiLoView */
/** @typedef {import("../../../src/games/_template/view-types").HiLoTurnView} TurnView */
/** @typedef {import("../screens.js").GameCtx<HiLoView>} Ctx */
/** @typedef {import("../screens.js").GameCtx<HiLoView | null>} RoomCtx */
/** @typedef {import("../screens.js").Part} Part */

import { avatar, banner, cell, crew, delta, group, h, note, ring, score, scoreStrip, title, waitCard } from "../ui.js";

/*
 * 猜大小 / High or Low in the game page: the page half of the template game
 * (the server half is src/games/_template). A new game copies this file to
 * games/<its id>.js; the shell (../main.js) loads it the first time someone
 * opens a room of that game.
 *
 * The shell has already logged in and keeps the connection; it draws the
 * lobby and the end screen (with this page's `lobby` and `ended` blocks in
 * them) and puts the screen's main actions on Telegram's bottom buttons. While
 * the game is on, `play` draws everything from `ctx.game`, which is exactly
 * what the server's `web.view` returned for this person. Taps go back with
 * `ctx.send({ a: "g", op, ...fields })` and land in the server's `web.onAction`.
 *
 * Draw with the building blocks in ../ui.js (their styles are in ../app.css);
 * anything of the game's own goes in _template.css, with class names that start
 * with the game's own prefix ("hilo-") so two games' styles never clash.
 * No emoji in the words (test/unit/style.test.ts checks).
 */

// ------------------------------------------------------------------ words

const zh = {
  turnOf: (/** @type {number} */ no, /** @type {number} */ total) => `第 ${no}/${total} 轮`,
  scores: "比分",
  pickTitle: "选一个数字",
  pickHint: "只有你看得到。可以在语音里虚张声势。",
  picking: (/** @type {string} */ name) => `${name} 在选数字`,
  pickingHint: "选好了大家就猜大小",
  yourNumber: "你选的数字，只有你看得到",
  guessTitle: (/** @type {string} */ name) => `${name} 选的是大还是小？`,
  guessHint: "大是 4–6，小是 1–3。大家都猜完之前可以改。",
  high: "大（4–6）",
  low: "小（1–3）",
  yourCall: (/** @type {string} */ side) => `你猜的是「${side}」，大家都猜完之前可以改`,
  sides: { high: "大", low: "小" },
  guessed: (/** @type {number} */ done, /** @type {number} */ total) => `${done}/${total} 人猜了`,
  numberWas: (/** @type {string} */ name) => `${name} 选的数字`,
  calls: "大家猜的",
  skipReasons: { host: "房主跳过了这一轮", left: "主角离开了", idle: "主角没选数字", ended: "游戏提前结束了" },
  turnPoints: "这一轮得分",
  noPoints: "这一轮没人得分",
  nextTurn: "下一轮",
  finish: "结束，看总结",
  rulesTitle: "怎么玩",
  rules: [
    ["轮流当主角", "主角秘密选一个 1 到 6 的数字，可以在语音里虚张声势"],
    ["猜大小", "其他人猜大（4–6）还是小（1–3）：猜对 +1，每有一个人猜错，主角 +1"],
  ],
  finalScores: "最终比分",
  summaryInGroup: "总结发在群里了。",
};

/** @typedef {typeof zh} Strings */

/** @type {Strings} */
const en = {
  turnOf: (no, total) => `Turn ${no}/${total}`,
  scores: "Scores",
  pickTitle: "Pick a number",
  pickHint: "Only you can see it. Bluff about it in voice chat if you like.",
  picking: (name) => `${name} is picking a number`,
  pickingHint: "Everyone guesses once it's picked",
  yourNumber: "Your number; only you can see it",
  guessTitle: (name) => `Did ${name} pick high or low?`,
  guessHint: "High is 4–6, low is 1–3. You can change your call until everyone's in.",
  high: "High (4–6)",
  low: "Low (1–3)",
  yourCall: (side) => `You called “${side}”; you can change it until everyone's in`,
  sides: { high: "high", low: "low" },
  guessed: (done, total) => `${done}/${total} called`,
  numberWas: (name) => `${name}'s number`,
  calls: "Calls",
  skipReasons: { host: "The host skipped this turn", left: "The lead left", idle: "The lead never picked", ended: "The game ended early" },
  turnPoints: "Points this turn",
  noPoints: "Nobody scored this turn",
  nextTurn: "Next turn",
  finish: "Finish and see the summary",
  rulesTitle: "How to play",
  rules: [
    ["Take turns leading", "The lead secretly picks a number from 1 to 6, and may bluff about it in voice chat"],
    ["High or low", "Everyone else calls high (4–6) or low (1–3): +1 for a right call, and +1 to the lead for each wrong one"],
  ],
  finalScores: "Final scores",
  summaryInGroup: "The summary is in the group.",
};

/** @param {string} lang */
const stringsFor = (lang) => (lang === "en" ? en : zh);

// ---------------------------------------------------------------- pieces

/**
 * The number on a card: big, or a question mark while nobody may see it.
 * @param {number | null} number
 * @param {string} caption
 */
function numberCard(number, caption) {
  return h("section", { class: "hilo-card" }, h("p", { class: "hilo-card-caption" }, caption), h("p", { class: "hilo-card-number" }, number === null ? "?" : String(number)));
}

/**
 * @param {TurnView["points"]} points
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

// ---------------------------------------------------------------- phases

/**
 * @param {Strings} t
 * @param {TurnView} turn
 * @param {(op: string, fields?: Record<string, unknown>) => void} act
 * @returns {Part}
 */
function picking(t, turn, act) {
  if (turn.role !== "lead") return { body: [waitCard(t.picking(turn.lead.name), t.pickingHint)] };
  return {
    body: [
      title(t.pickTitle),
      note(t.pickHint),
      h(
        "div",
        { class: "hilo-numbers" },
        [1, 2, 3, 4, 5, 6].map((number) => h("button", { type: "button", class: "hilo-number", onclick: () => act("pick", { number }) }, String(number))),
      ),
    ],
  };
}

/**
 * @param {Strings} t
 * @param {TurnView} turn
 * @param {(op: string, fields?: Record<string, unknown>) => void} act
 * @returns {Part}
 */
function guessing(t, turn, act) {
  const done = turn.guessers.filter((guesser) => guesser.guessed).length;
  const who = crew(turn.guessers, (guesser) => guesser.guessed, t.guessed(done, turn.guessers.length));
  if (turn.role === "lead") return { body: [numberCard(turn.number, t.yourNumber), who] };
  if (turn.role === "watcher") return { body: [waitCard(t.guessTitle(turn.lead.name), t.guessHint), who] };
  // The two calls are the screen's main actions, so they go on Telegram's bottom buttons; the current one is green.
  return {
    body: [title(t.guessTitle(turn.lead.name)), note(turn.mine ? t.yourCall(t.sides[turn.mine]) : t.guessHint), who],
    main: { label: t.high, kind: turn.mine === "high" ? "go" : "primary", onClick: () => act("guess", { side: "high" }) },
    secondary: { label: t.low, kind: turn.mine === "low" ? "go" : "primary", onClick: () => act("guess", { side: "low" }) },
  };
}

/**
 * The result: the number for everyone, who called what, the points.
 * @param {Ctx} ctx
 * @param {Strings} t
 * @param {TurnView} turn
 * @param {(op: string, fields?: Record<string, unknown>) => void} act
 * @returns {Part}
 */
function result(ctx, t, turn, act) {
  const { view, game } = ctx;
  const answer = turn.number === null ? null : turn.number >= 4 ? "high" : "low";
  return {
    body: [
      numberCard(turn.number, t.numberWas(turn.lead.name)),
      turn.skipReason ? note(t.skipReasons[turn.skipReason]) : null,
      turn.guessers.some((guesser) => guesser.side)
        ? group(
            t.calls,
            h(
              "ul",
              { class: "section" },
              turn.guessers.map((guesser) =>
                cell({
                  before: avatar(guesser, 28),
                  title: guesser.name,
                  after: guesser.side ? `${guesser.side === answer ? "✓" : "✗"} ${t.sides[guesser.side]}` : "",
                }),
              ),
            ),
          )
        : null,
      pointsGroup(turn.points, t),
    ],
    // Anyone in the game can move on; otherwise the next turn starts by itself when the clock runs out.
    main: view.me.isPlayer || view.me.isHost ? { label: game.last ? t.finish : t.nextTurn, onClick: () => act("next") } : null,
  };
}

// ------------------------------------------------------------------ page

/** @type {import("../screens.js").GamePage<HiLoView>} */
const page = {
  strings: { zh, en },
  styles: true, // load _template.css with this page

  play(ctx) {
    const { view, game, ui } = ctx;
    const t = stringsFor(view.lang);
    const turn = game.turn;
    if (!turn) return { body: [note(ui.connecting)] };
    // Every tap names its turn, so the server can ignore one that arrives after the turn moved on.
    const act = (/** @type {string} */ op, /** @type {Record<string, unknown>} */ fields = {}) => ctx.send({ a: "g", op, turn: turn.no, ...fields });
    const part = turn.phase === "picking" ? picking(t, turn, act) : turn.phase === "guessing" ? guessing(t, turn, act) : result(ctx, t, turn, act);
    return {
      ...part,
      title: `${view.room.title} · ${t.turnOf(game.progress.no, game.progress.total)}`,
      body: [
        h("div", { class: "hud" }, h("span", { class: "hud-round" }, t.turnOf(game.progress.no, game.progress.total)), turn.endsAt !== null ? ring(turn.endsAt, turn.span) : null),
        scoreStrip(game.scores, { me: view.me.id, lead: turn.lead.id, label: t.scores }),
        !view.me.isPlayer && turn.phase !== "done" ? banner(ui.watching) : null,
        ...part.body,
      ],
    };
  },

  /** Under the lobby's settings: the rules. */
  lobby(ctx) {
    const t = stringsFor(ctx.view.lang);
    return [group(t.rulesTitle, h("ul", { class: "section" }, t.rules.map(([heading, text]) => cell({ cls: "how", before: h("i", { class: "how-dot" }), title: heading, sub: text }))))];
  },

  /** On the end screen: the final scores (the full summary goes to the group). */
  ended(ctx) {
    const { view, game } = ctx;
    const t = stringsFor(view.lang);
    if (!game || game.scores.length === 0) return [];
    return [
      group(
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
      ),
    ];
  },

  /** A new view arrived: a buzz when your turn to lead begins. Returns nothing to animate. */
  react(before, after, { me, haptics }) {
    const turn = after?.turn;
    if (turn && turn.no !== before?.turn?.no && turn.lead.id === me.id) haptics?.impactOccurred("heavy");
    return null;
  },
};

export default page;
