// @ts-check
/** @typedef {import("../../src/web/protocol").WebView} WebView */
/** @typedef {import("../../src/web/protocol").WebSetting} WebSetting */
/** @typedef {import("../../src/web/protocol").ClientMessage} ClientMessage */
/** @typedef {import("./i18n.js").Strings} Strings */

import { avatar, cell, group, h, masthead, note, pill, waitCard } from "./ui.js";

/**
 * The game page is a shell plus one page module per game.
 *
 * The shell (main.js, this file, ui.js, i18n.js, app.css) logs in, keeps the
 * connection, and draws the lobby, the end screen and the bottom buttons. While
 * a game is on, the screen comes from public/app/games/<game id>.js, which the
 * shell loads the first time someone opens a room of that game. A new game
 * starts from games/_template.js.
 */

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
 * One screen as a game page (or the shell) describes it.
 * @typedef {object} Part
 * @property {Array<Node | null>} body   conditional pieces may be null; they are skipped
 * @property {Composer | null} [composer]   never together with `main` / `secondary`
 * @property {Action | null} [main]
 * @property {Action | null} [secondary]
 * @property {string} [title]   the page's title; the room's title when left out
 * @property {string | null} [mode]   becomes <html data-mode>, for the game's styles (e.g. a colour per mode)
 */

/**
 * @typedef {object} Screen
 * @property {string} title
 * @property {string | null} mode
 * @property {Array<Node | null>} body
 * @property {Composer | null} composer
 * @property {Action | null} main
 * @property {Action | null} secondary
 */

/**
 * Telegram's haptic feedback; null outside Telegram.
 * @typedef {object} Haptics
 * @property {(style: "light" | "medium" | "heavy") => void} impactOccurred
 * @property {(type: "success" | "error" | "warning") => void} notificationOccurred
 */

/**
 * What a game page draws with.
 * @template GameView
 * @typedef {object} GameCtx
 * @property {WebView} view   the whole view: the room, and who is looking (`view.me`)
 * @property {GameView} game   the game's own part of it: what its `web.view` returned on the server
 * @property {Strings} ui   the shell's words (connecting, watching) in the view's language
 * @property {(message: ClientMessage) => void} send   game taps are `{ a: "g", op, ...fields }`
 * @property {unknown} fx   what `react` returned for the view being drawn; null on redraws
 */

/**
 * The page half of a Mini App game: the default export of public/app/games/<game id>.js.
 * @template GameView
 * @typedef {object} GamePage
 * @property {Record<"zh" | "en", Record<string, unknown>>} strings   the game's words (tests check both languages and look for emoji)
 * @property {(ctx: GameCtx<GameView>) => Part} play   the screen while the game is on
 * @property {(ctx: GameCtx<GameView | null>) => Array<Node | null>} [lobby]   blocks under the lobby's settings: the rules, tips
 * @property {(ctx: GameCtx<GameView | null>) => Array<Node | null>} [ended]   blocks on the end screen, e.g. the final scores
 * @property {(before: GameView | null, after: GameView | null, ctx: { me: WebView["me"], haptics: Haptics | null }) => unknown} [react]
 *   a new view arrived: buzz the phone if something happened to this person, and return what the next draw
 *   should animate (`play` gets it as `ctx.fx`)
 * @property {boolean} [styles]   the game has a stylesheet of its own, games/<game id>.css
 */

/**
 * @typedef {object} ShellCtx
 * @property {WebView} view
 * @property {GamePage<unknown>} page
 * @property {Strings} t
 * @property {(message: ClientMessage) => void} send
 * @property {() => void} joinNextRoom
 * @property {unknown} fx
 */

// ------------------------------------------------------------------ lobby

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
 * @param {ShellCtx} ctx
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
 * @param {ShellCtx} ctx
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
 * @param {ShellCtx} ctx
 * @param {Array<Node | null>} extra   the game's blocks (its rules)
 * @returns {Part}
 */
function lobbyScreen(ctx, extra) {
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
    ...extra,
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
 * @param {ShellCtx} ctx
 * @param {Array<Node | null>} extra   the game's blocks (final scores)
 * @returns {Part}
 */
function endedScreen(ctx, extra) {
  const { view, t } = ctx;
  return {
    body: [masthead(t.gameOver, view.room.endReason), ...extra],
    main: view.room.next !== null ? { label: t.nextRoom, onClick: ctx.joinNextRoom } : null,
  };
}

// ----------------------------------------------------------------- screen

/**
 * @param {string} title   used when the part has none of its own
 * @param {Part} part
 * @returns {Screen}
 */
function screen(title, part) {
  return {
    title: part.title ?? title,
    mode: part.mode ?? null,
    body: part.body,
    composer: part.composer ?? null,
    main: part.main ?? null,
    secondary: part.secondary ?? null,
  };
}

/**
 * The lobby and the end screen are the shell's (with the game's blocks in them); in between, the game draws.
 * @param {ShellCtx} ctx
 * @returns {Screen}
 */
export function screenFor(ctx) {
  const { view, page, t } = ctx;
  const room = view.room;
  /** @type {GameCtx<unknown>} */
  const gameCtx = { view, game: view.game, ui: t, send: ctx.send, fx: ctx.fx };
  if (room.status === "lobby") return screen(room.title, lobbyScreen(ctx, page.lobby?.(gameCtx) ?? []));
  if (room.status === "ended") return screen(room.title, endedScreen(ctx, page.ended?.(gameCtx) ?? []));
  if (view.game === null) return screen(room.title, { body: [note(t.connecting)] });
  return screen(room.title, page.play(gameCtx));
}

/**
 * A full-page message: connecting, or why the page can't be used.
 * @param {string} heading
 * @param {string} message
 * @returns {Screen}
 */
export function messageScreen(heading, message) {
  return screen(heading, { body: [masthead(heading, null), waitCard(message, null)] });
}
