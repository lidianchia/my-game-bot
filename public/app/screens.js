// @ts-check
/** @typedef {import("../../src/web/protocol").WebView} WebView */
/** @typedef {import("../../src/web/protocol").WebPerson} WebPerson */
/** @typedef {import("../../src/web/protocol").WebSetting} WebSetting */
/** @typedef {import("../../src/web/protocol").ClientMessage} ClientMessage */
/** @typedef {import("../../src/games/guess/view-types").GuessView} GuessView */
/** @typedef {import("../../src/games/guess/view-types").TabooView} TabooView */
/** @typedef {import("../../src/games/guess/view-types").UniqueView} UniqueView */
/** @typedef {import("../../src/games/guess/view-types").Points} Points */
/** @typedef {import("./i18n.js").Strings} Strings */
/** @typedef {import("./ui.js").Child} Child */

import { avatar, delta, h, icon, ring, score } from "./ui.js";

/**
 * What the input bar at the bottom is for right now. Switching `key` clears
 * whatever was typed; the same key keeps it across redraws.
 *
 * @typedef {object} Composer
 * @property {string} key
 * @property {string} placeholder
 * @property {string} button   what the send button does (read out; the button itself is an arrow)
 * @property {number} maxLength
 * @property {(text: string) => ClientMessage} toMessage
 */

/**
 * A button for the bottom of the screen. main.js shows it as Telegram's own
 * bottom button when the app supports it, and as a page button otherwise.
 *
 * @typedef {object} Action
 * @property {string} label
 * @property {() => void} onClick
 * @property {"primary" | "go"} [kind]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {object} Screen
 * @property {string} title
 * @property {"taboo" | "unique" | null} mode   tints the screen in that mode's colour
 * @property {Array<Node | null>} body   conditional pieces may be null; they are skipped
 * @property {Composer | null} composer   never together with `main` / `secondary`
 * @property {Action | null} main
 * @property {Action | null} secondary
 */

/**
 * What just changed, for one-off animations on the draw right after it.
 * @typedef {object} Fx
 * @property {number} fresh   new lines at the top of the guess feed
 * @property {"hit" | "foul" | null} flash   a word was just guessed / a foul was just called
 */

/**
 * @typedef {object} Ctx
 * @property {WebView} view
 * @property {Strings} t
 * @property {(message: ClientMessage) => void} send
 * @property {() => void} joinNextRoom
 * @property {number} revealTurn  the turn whose card should flip over on this draw (-1 = none)
 * @property {Fx} fx
 */

/**
 * One screen's own part, before the shared top (turn, clock, scores) goes on.
 * @typedef {object} Part
 * @property {Array<Node | null>} body
 * @property {Composer | null} [composer]
 * @property {Action | null} [main]
 * @property {Action | null} [secondary]
 */

// ---------------------------------------------------------------- pieces

/**
 * A small button inside the page.
 * @param {string} label
 * @param {() => void} onClick
 * @param {"soft" | "go" | "destructive"} [kind]
 */
function pill(label, onClick, kind = "soft") {
  return h("button", { type: "button", class: `pill pill-${kind}`, onclick: onClick }, label);
}

/**
 * A titled block: a header, a section of rows, and an optional footnote.
 * @param {string | null} header
 * @param {Node} content
 * @param {string | null} [footer]
 */
function group(header, content, footer = null) {
  return h(
    "div",
    { class: "group" },
    header ? h("h3", { class: "group-header" }, header) : null,
    content,
    footer ? h("p", { class: "group-footer" }, footer) : null,
  );
}

/**
 * One row of a section, laid out like a Telegram list item.
 * @param {{ before?: Child | Child[], title: Child, sub?: string | null, after?: Child, cls?: string }} parts
 */
function cell(parts) {
  return h(
    "li",
    { class: `cell${parts.cls ? ` ${parts.cls}` : ""}` },
    parts.before ?? null,
    h("div", { class: "cell-body" }, h("span", { class: "cell-title" }, parts.title), parts.sub ? h("span", { class: "cell-sub" }, parts.sub) : null),
    typeof parts.after === "string" ? h("span", { class: "cell-after" }, parts.after) : (parts.after ?? null),
  );
}

/** @param {string} text */
const note = (text) => h("p", { class: "note" }, text);

/** @param {string} text */
const title = (text) => h("h2", { class: "title" }, text);

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
 * Everyone's score; the person leading this turn gets a ring in the mode's colour.
 * @param {GuessView} game
 * @param {WebView} view
 * @param {number} leadId
 * @param {Strings} t
 */
function scoreStrip(game, view, leadId, t) {
  return h(
    "ol",
    { class: "scores", "aria-label": t.scores },
    game.scores.map((entry) =>
      h(
        "li",
        { class: `score${entry.id === leadId ? " is-lead" : ""}${entry.id === view.me.id ? " is-me" : ""}` },
        avatar(entry, 32),
        h("span", { class: "score-text" }, h("span", { class: "score-name" }, entry.name), h("span", { class: "score-value" }, score(entry.score))),
      ),
    ),
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
 * A card without a word on it: what the guesser sees while the others work.
 * @param {string} heading
 * @param {string | null} hint
 */
function waitCard(heading, hint) {
  return h("section", { class: "wait-card" }, h("p", { class: "lead-title" }, heading), hint ? h("p", { class: "lead-note" }, hint) : null);
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
 * Who has done their part (written, checked): avatars with a tick.
 * @param {Array<WebPerson & { wrote?: boolean, confirmed?: boolean }>} people
 * @param {(person: { wrote?: boolean, confirmed?: boolean }) => boolean} done
 * @param {string} label
 */
function crew(people, done, label) {
  return group(
    label,
    h(
      "ul",
      { class: "crew" },
      people.map((person) =>
        h(
          "li",
          { class: done(person) ? "done" : "" },
          avatar(person, 40, done(person) ? { badge: "✓", tone: "done" } : {}),
          h("span", { class: "crew-name" }, person.name),
        ),
      ),
    ),
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
 * @param {GuessView} game
 * @returns {Action | null}
 */
function nextAction(ctx, game) {
  const { view, t } = ctx;
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
 * @param {GuessView} game
 * @param {TabooView} turn
 * @returns {Part}
 */
function tabooScreen(ctx, game, turn) {
  const { t, send, fx } = ctx;
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
    main: nextAction(ctx, game),
  };
}

// ---------------------------------------------------------- Unique Clues

/**
 * @param {Ctx} ctx
 * @param {UniqueView} turn
 * @param {boolean} interactive  writers may strike clues during the review
 */
function clueSlips(ctx, turn, interactive) {
  const { t } = ctx;
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
 * @param {GuessView} game
 * @param {UniqueView} turn
 * @returns {Part}
 */
function uniqueScreen(ctx, game, turn) {
  const { t, view } = ctx;
  const act = (/** @type {Record<string, unknown>} */ fields) => ctx.send({ a: "g", op: String(fields.op), turn: turn.no, ...fields });
  const lead = turn.lead.name;
  const wroteCount = turn.writers.filter((writer) => writer.wrote).length;
  const confirmedCount = turn.writers.filter((writer) => writer.confirmed).length;
  const wrote = () => crew(turn.writers, (w) => !!w.wrote, t.wrote(wroteCount, turn.writers.length));
  const checked = () => crew(turn.writers, (w) => !!w.confirmed, t.confirmed(confirmedCount, turn.writers.length));
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
      body: [face({ small: true }), title(t.reviewTitle), note(t.reviewRules), clueSlips(ctx, turn, writer), checked()],
      main: writer && !mine?.confirmed ? { label: t.reviewed, kind: "go", onClick: () => act({ op: "confirm" }) } : null,
    };
  }

  if (turn.phase === "guessing") {
    if (turn.role === "lead") {
      return {
        body: [
          title(t.yourGuess),
          note(t.oneTry),
          clueSlips(ctx, turn, false),
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
    return { body: [face({ small: true }), title(t.waitForGuess(lead)), clueSlips(ctx, turn, false)] };
  }

  // Turn over: the card turns over for the guesser, everyone sees how it went.
  const outcome = turn.outcome;
  const tone = outcome === "correct" ? " right" : outcome === "wrong" ? " wrong" : "";
  return {
    body: [
      face({ reveal: ctx.revealTurn === turn.no }),
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
      clueSlips(ctx, turn, false),
      pointsGroup(turn.points, t),
    ],
    main: nextAction(ctx, game),
    secondary:
      view.me.isHost && outcome === "wrong" && !turn.accepted
        ? { label: t.ruleRight, kind: "go", onClick: () => ctx.send({ a: "g", op: "accept" }) }
        : null,
  };
}

// ------------------------------------------------------------------ lobby

/**
 * The big title the lobby and the end screen open with.
 * @param {string} heading
 * @param {string | null} sub
 */
function masthead(heading, sub) {
  return h("header", { class: "masthead" }, h("h1", { class: "large-title" }, heading), sub ? h("p", { class: "masthead-sub" }, sub) : null);
}

/**
 * Choices side by side, like Telegram's segmented controls.
 * @param {WebSetting} setting
 * @param {(value: string) => void} pick
 */
function segmented(setting, pick) {
  return h(
    "div",
    { class: "seg", role: "group", "aria-label": setting.label },
    setting.options.map((option) =>
      h(
        "button",
        {
          type: "button",
          class: "seg-option",
          "aria-pressed": option.on ? "true" : "false",
          onclick: () => {
            if (!option.on) pick(option.value);
          },
        },
        option.label,
      ),
    ),
  );
}

/**
 * The host changes settings right here; everyone else sees what was picked.
 * @param {Ctx} ctx
 */
function settingsGroup(ctx) {
  const { view, t } = ctx;
  const room = view.room;
  if (room.options.length === 0) return group(t.settings, h("ul", { class: "section" }, room.settings.map((line) => cell({ title: line }))));
  if (!view.me.isHost) {
    return group(
      t.settings,
      h("ul", { class: "section" }, room.options.map((row) => cell({ title: row.label, after: row.options.find((option) => option.on)?.label ?? "" }))),
    );
  }
  return group(
    t.settings,
    h(
      "ul",
      { class: "section" },
      room.options.map((row) =>
        h("li", { class: "cell cell-setting" }, h("span", { class: "cell-title" }, row.label), segmented(row, (value) => ctx.send({ a: "set", key: row.key, value }))),
      ),
    ),
  );
}

/**
 * For a host who's still alone: how to get people into the room.
 * @param {Ctx} ctx
 */
function recruitGuide(ctx) {
  const { view, t } = ctx;
  return group(
    t.recruitTitle,
    h(
      "ol",
      { class: "section steps" },
      t.recruitSteps.map((step, index) => cell({ cls: "step", before: h("span", { class: "step-no" }, String(index + 1)), title: step })),
    ),
    t.recruitFooter(view.room.minPlayers, view.room.players.length),
  );
}

/**
 * The rules, for the modes this game will actually play.
 * @param {Ctx} ctx
 */
function howToPlay(ctx) {
  const { view, t } = ctx;
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

/**
 * @param {Ctx} ctx
 * @returns {Part}
 */
function lobbyScreen(ctx) {
  const { view, t } = ctx;
  const room = view.room;
  const enough = room.players.length >= room.minPlayers;
  /** @type {Array<Node | null>} */
  const body = [
    masthead(room.title, t.roomLine(room.id, room.players.length, room.maxPlayers)),
    h(
      "ul",
      { class: "people", "aria-label": t.players(room.players.length, room.maxPlayers) },
      room.players.map((player) =>
        h(
          "li",
          { class: player.id === view.me.id ? "me" : "" },
          avatar(player, 54, player.id === room.host.id ? { badge: "♛", tone: "host" } : {}),
          h("span", { class: "person-name" }, player.name),
        ),
      ),
    ),
    room.requests.length
      ? group(
          t.requests,
          h(
            "ul",
            { class: "section" },
            room.requests.map((request) =>
              cell({
                before: avatar(request.user, 36),
                title: request.user.name,
                after: h(
                  "span",
                  { class: "request-actions" },
                  pill(t.deny, () => ctx.send({ a: "deny", request: request.id })),
                  pill(t.approve, () => ctx.send({ a: "approve", request: request.id }), "go"),
                ),
              }),
            ),
          ),
        )
      : null,
    view.me.isHost && !enough ? recruitGuide(ctx) : null,
    settingsGroup(ctx),
    howToPlay(ctx),
  ];

  if (view.me.isHost) {
    return { body, main: { label: t.startGame, onClick: () => ctx.send({ a: "start" }), disabled: !enough } };
  }
  if (view.me.isPlayer) body.push(note(t.waitForHost(room.host.name)));
  else if (view.me.requested) body.push(note(t.asked));
  else {
    body.push(note(t.notInGame));
    return { body, main: { label: t.askToJoin, onClick: () => ctx.send({ a: "join" }) } };
  }
  return { body };
}

// ------------------------------------------------------------------- ended

/**
 * @param {Ctx} ctx
 * @returns {Part}
 */
function endedScreen(ctx) {
  const { view, t } = ctx;
  const game = /** @type {GuessView | null} */ (view.game);
  return {
    body: [
      masthead(t.gameOver, view.room.endReason),
      game && game.scores.length
        ? group(
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
          )
        : null,
    ],
    main: view.room.next !== null ? { label: t.nextRoom, onClick: ctx.joinNextRoom } : null,
  };
}

// ----------------------------------------------------------------- screen

/**
 * @param {string} title
 * @param {"taboo" | "unique" | null} mode
 * @param {Part} part
 * @returns {Screen}
 */
function screen(title, mode, part) {
  return { title, mode, body: part.body, composer: part.composer ?? null, main: part.main ?? null, secondary: part.secondary ?? null };
}

/**
 * @param {Ctx} ctx
 * @returns {Screen}
 */
export function screenFor(ctx) {
  const { view, t } = ctx;
  const room = view.room;
  if (room.status === "lobby") return screen(room.title, null, lobbyScreen(ctx));
  if (room.status === "ended") return screen(room.title, null, endedScreen(ctx));

  const game = /** @type {GuessView | null} */ (view.game);
  if (!game || !game.turn) return screen(room.title, null, { body: [note(t.connecting)] });
  const turn = game.turn;
  const part = turn.mode === "taboo" ? tabooScreen(ctx, game, turn) : uniqueScreen(ctx, game, turn);
  const watching = !view.me.isPlayer && turn.phase !== "done" ? h("p", { class: "banner" }, t.watching) : null;
  return screen(`${room.title} · ${t.turnOf(game.progress.no, game.progress.total)}`, turn.mode, {
    ...part,
    body: [hud(t, game, turn), scoreStrip(game, view, turn.lead.id, t), watching, ...part.body],
  });
}

/**
 * A full-page message: connecting, or why the page can't be used.
 * @param {string} heading
 * @param {string} message
 * @returns {Screen}
 */
export function messageScreen(heading, message) {
  return screen(heading, null, { body: [masthead(heading, null), waitCard(message, null)] });
}
