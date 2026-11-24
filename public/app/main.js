// @ts-check
/** @typedef {import("../../src/web/protocol").WebView} WebView */
/** @typedef {import("../../src/web/protocol").ClientMessage} ClientMessage */
/** @typedef {import("../../src/web/protocol").ServerMessage} ServerMessage */
/** @typedef {import("./screens.js").Composer} Composer */
/** @typedef {import("./screens.js").Screen} Screen */
/** @typedef {import("./screens.js").Action} Action */
/** @typedef {import("./screens.js").Haptics} Haptics */
/** @typedef {import("./screens.js").GamePage<unknown>} GamePage */

import { stringsFor } from "./i18n.js";
import { messageScreen, screenFor } from "./screens.js";
import { clock, h, RING_LENGTH } from "./ui.js";

/**
 * Telegram's own buttons along the bottom of the app (MainButton, SecondaryButton).
 * `color` / `text_color` set to null go back to the theme's.
 * @typedef {object} BottomButton
 * @property {(params: { text?: string, color?: string | null, text_color?: string | null, is_active?: boolean, is_visible?: boolean, position?: "left" | "right" | "top" | "bottom" }) => unknown} setParams
 * @property {(handler: () => void) => unknown} onClick
 */

/**
 * The slice of Telegram's Mini App SDK (telegram-web-app.js) this page uses.
 * @typedef {object} TelegramWebApp
 * @property {string} initData
 * @property {{ start_param?: string, user?: { language_code?: string } }} initDataUnsafe
 * @property {"light" | "dark"} colorScheme
 * @property {Partial<Record<"bg_color" | "secondary_bg_color" | "section_bg_color" | "hint_color" | "button_color" | "button_text_color", string>>} themeParams
 * @property {() => void} ready
 * @property {() => void} expand
 * @property {(version: string) => boolean} isVersionAtLeast
 * @property {(color: string) => void} setHeaderColor
 * @property {(color: string) => void} setBackgroundColor
 * @property {(color: string) => void} [setBottomBarColor]
 * @property {() => void} [disableVerticalSwipes]
 * @property {(event: string, handler: () => void) => void} onEvent
 * @property {BottomButton} MainButton
 * @property {BottomButton} [SecondaryButton]
 * @property {Haptics} HapticFeedback
 */

/** Must match CLOSE_SESSION_EXPIRED in src/web/protocol.ts. */
const CLOSE_SESSION_EXPIRED = 4001;
const TOAST_MS = 2600;

const tg = /** @type {{ Telegram?: { WebApp?: TelegramWebApp } }} */ (/** @type {unknown} */ (window)).Telegram?.WebApp;

const state = {
  /** @type {WebView | null} */
  view: null,
  /** Server clock minus ours, so countdowns are right even when the phone's clock isn't. */
  clockOffset: 0,
  /** @type {string | null} */
  token: null,
  /** @type {number | null} a newer room to log into, after the previous game ended */
  room: null,
  /** @type {keyof ReturnType<typeof stringsFor>["errors"] | null} */
  error: null,
  connected: false,
  /** Has the page ever been connected (decides "connecting" vs "reconnecting"). */
  wasConnected: false,
  /** @type {unknown} what the game page's `react` wants the next draw to animate; that draw only */
  fx: null,
};

/** @type {WebSocket | null} */
let socket = null;
let retries = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let retryTimer = null;

// ------------------------------------------------------------------ dom

const els = {
  body: /** @type {HTMLElement} */ (document.getElementById("body")),
  composer: /** @type {HTMLFormElement} */ (document.getElementById("composer")),
  input: /** @type {HTMLInputElement} */ (document.getElementById("composer-input")),
  send: /** @type {HTMLButtonElement} */ (document.getElementById("composer-send")),
  toast: /** @type {HTMLElement} */ (document.getElementById("toast")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
};

/** @type {Composer | null} */
let composer = null;

function strings() {
  const lang = state.view?.lang ?? (tg?.initDataUnsafe.user?.language_code?.startsWith("en") ? "en" : "zh");
  return stringsFor(lang);
}

const serverNow = () => Date.now() + state.clockOffset;

// ----------------------------------------------------------------- draw

function draw() {
  const t = strings();
  const view = state.view;
  document.documentElement.lang = t.lang === "en" ? "en" : "zh-CN";
  /** @type {Screen} */
  let screen;
  if (state.error) screen = messageScreen(t.appTitle, t.errors[state.error]);
  else if (!view) screen = messageScreen(t.appTitle, state.wasConnected ? t.reconnecting : t.connecting);
  else {
    const page = gamePage(view.room.game);
    if (page === "loading") screen = messageScreen(view.room.title, t.connecting);
    else if (page === "failed") screen = messageScreen(view.room.title, t.errors.page);
    else screen = screenFor({ view, page, t, send, joinNextRoom, fx: state.fx });
  }

  document.title = screen.title;
  document.documentElement.dataset.game = view?.room.game ?? "";
  document.documentElement.dataset.mode = screen.mode ?? "";
  const body = screen.body.filter(/** @returns {node is Node} */ (node) => node !== null);
  const inPage = applyActions(screen.main, screen.secondary);
  if (inPage.length) body.push(h("div", { class: "actions" }, inPage.map(pageButton)));
  els.body.replaceChildren(...body);
  els.status.textContent = state.view && !state.connected && !state.error ? t.reconnecting : "";
  els.status.hidden = els.status.textContent === "";
  applyComposer(screen.composer);
  tick();
}

// ------------------------------------------------------- bottom buttons

/** Telegram's own bottom buttons, when this Telegram has them; otherwise the buttons go in the page. */
const nativeMain = tg?.isVersionAtLeast("6.1") ? tg.MainButton : null;
const nativeSecondary = tg?.isVersionAtLeast("7.10") ? (tg.SecondaryButton ?? null) : null;
/** @type {{ main: Action | null, secondary: Action | null }} */
const shown = { main: null, secondary: null };
nativeMain?.onClick(() => {
  if (shown.main && !shown.main.disabled) shown.main.onClick();
});
nativeSecondary?.onClick(() => {
  if (shown.secondary && !shown.secondary.disabled) shown.secondary.onClick();
});

/** Must match --green in app.css. */
const GREEN = { light: "#34c759", dark: "#30d158" };

/**
 * Puts this screen's actions on Telegram's bottom buttons and returns the ones that have to go in the page instead.
 * @param {Action | null} main
 * @param {Action | null} secondary
 * @returns {Action[]}
 */
function applyActions(main, secondary) {
  shown.main = main;
  shown.secondary = secondary;
  /** @type {Action[]} */
  const inPage = [];
  if (nativeMain) setBottomButton(nativeMain, main, false);
  else if (main) inPage.push(main);
  if (nativeMain && nativeSecondary) setBottomButton(nativeSecondary, secondary, true);
  else if (secondary) inPage.push(secondary);
  return inPage;
}

/**
 * @param {BottomButton} button
 * @param {Action | null} action
 * @param {boolean} secondary
 */
function setBottomButton(button, action, secondary) {
  if (!action) {
    button.setParams({ is_visible: false });
    return;
  }
  const theme = tg?.themeParams ?? {};
  const green = GREEN[tg?.colorScheme ?? "light"];
  /** @type {Parameters<BottomButton["setParams"]>[0]} */
  const params = { text: action.label, is_visible: true, is_active: !action.disabled };
  if (secondary) {
    // A card-coloured button on the page-coloured bar, with the action's colour as text.
    params.position = "left";
    params.color = theme.section_bg_color ?? theme.bg_color ?? null;
    params.text_color = action.kind === "go" ? green : null;
  } else if (action.disabled) {
    params.color = theme.hint_color ?? null;
    params.text_color = "#ffffff";
  } else if (action.kind === "go") {
    params.color = green;
    params.text_color = "#ffffff";
  } else {
    params.color = null;
    params.text_color = null;
  }
  button.setParams(params);
}

/** Outside Telegram (or on a very old app) the bottom buttons are plain page buttons. */
function pageButton(/** @type {Action} */ action) {
  return h(
    "button",
    { type: "button", class: `btn btn-${action.kind ?? "primary"}`, disabled: action.disabled, onclick: action.onClick },
    action.label,
  );
}

/** The input bar persists across redraws so typing isn't lost when someone else's guess arrives. */
function applyComposer(/** @type {Composer | null} */ next) {
  if (!next) {
    composer = null;
    els.composer.hidden = true;
    return;
  }
  if (composer?.key !== next.key) els.input.value = "";
  composer = next;
  els.composer.hidden = false;
  els.input.placeholder = next.placeholder;
  els.input.maxLength = next.maxLength;
  els.send.setAttribute("aria-label", next.button);
  els.send.title = next.button;
}

/** Turns the countdown rings; runs a few times a second. */
function tick() {
  const now = serverNow();
  for (const timer of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".ring[data-ends]"))) {
    const left = Math.max(0, Number(timer.dataset.ends) - now);
    const span = Number(timer.dataset.span);
    const share = span > 0 ? Math.min(1, left / span) : 1;
    const bar = /** @type {SVGElement | null} */ (timer.querySelector(".ring-bar"));
    const label = timer.querySelector(".ring-label");
    if (bar) bar.style.strokeDashoffset = (RING_LENGTH * (1 - share)).toFixed(2);
    if (label) label.textContent = left >= 60_000 ? clock(left) : String(Math.ceil(left / 1000));
    timer.classList.toggle("urgent", left < 10_000);
  }
}

function toast(/** @type {string} */ text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(Number(els.toast.dataset.timer));
  els.toast.dataset.timer = String(setTimeout(() => els.toast.classList.remove("show"), TOAST_MS));
}

// ----------------------------------------------------------- game pages

/** Game ids are lowercase letters, digits and `_` (GameModule.id); nothing else goes into a module path. */
const GAME_ID = /^[a-z0-9_]{1,32}$/;
const PAGE_RETRY_MS = 3000;

/** Each game's page module once asked for: loaded, on its way, or failed (tried again shortly). */
/** @type {Map<string, GamePage | "loading" | "failed">} */
const pages = new Map();
/** Failed loads per game, so a retry asks for a fresh copy rather than the remembered failure. */
/** @type {Map<string, number>} */
const pageFailures = new Map();

/**
 * The page module that draws a game, loading it (games/<id>.js) the first time it's asked for.
 * @param {string} id
 * @returns {GamePage | "loading" | "failed"}
 */
function gamePage(id) {
  const known = pages.get(id);
  if (known) return known;
  if (!GAME_ID.test(id)) return "failed";
  pages.set(id, "loading");
  void loadPage(id).then((page) => {
    if (!page) {
      pages.set(id, "failed");
      pageFailures.set(id, (pageFailures.get(id) ?? 0) + 1);
      setTimeout(() => {
        pages.delete(id);
        draw();
      }, PAGE_RETRY_MS);
      draw();
      return;
    }
    pages.set(id, page);
    // The views that came in while it loaded weren't reacted to; this one is the first the game sees.
    if (state.view?.room.game === id) state.fx = react(page, null, state.view);
    draw();
    state.fx = null;
  });
  return "loading";
}

/**
 * @param {string} id
 * @returns {Promise<GamePage | null>}
 */
async function loadPage(id) {
  const retry = pageFailures.get(id);
  try {
    const module = /** @type {{ default: GamePage }} */ (await import(`./games/${id}.js${retry ? `?retry=${retry}` : ""}`));
    if (module.default.styles) await loadStyles(`/app/games/${id}.css`);
    return module.default;
  } catch (error) {
    console.error("loading the game's page failed", id, error);
    return null;
  }
}

/** Adds a stylesheet and waits for it, so the game's first screen doesn't flash unstyled. @param {string} href */
function loadStyles(href) {
  return new Promise((resolve) => {
    const link = h("link", { rel: "stylesheet", href });
    link.addEventListener("load", resolve);
    link.addEventListener("error", resolve);
    document.head.append(link);
  });
}

/**
 * Lets the game's page react to a new view (haptics) and say what the next draw should animate.
 * @param {GamePage} page
 * @param {WebView | null} before
 * @param {WebView} after
 */
function react(page, before, after) {
  if (!page.react) return null;
  const sameRoom = before?.room.id === after.room.id && before.room.game === after.room.game;
  return page.react(sameRoom ? (before.game ?? null) : null, after.game ?? null, { me: after.me, haptics: tg?.HapticFeedback ?? null }) ?? null;
}

// ----------------------------------------------------------- connection

/** Trades Telegram's signed launch data for a session token. Null = try again later. */
async function login() {
  const initData = tg?.initData ?? "";
  if (!initData) {
    state.error = "openFromGroup";
    return false;
  }
  try {
    const response = await fetch("/app/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, room: state.room ?? undefined }),
    });
    /** @type {{ token?: string, room?: number, error?: string }} */
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.token) {
      state.token = body.token;
      state.error = null;
      return true;
    }
    if (body.error === "auth" || body.error === "member" || body.error === "room" || body.error === "link") {
      state.error = body.error;
      return false;
    }
  } catch {
    // Offline or the server is unreachable: retry.
  }
  return null;
}

async function start() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!state.token) {
    const ok = await login();
    if (ok === false) {
      draw();
      return;
    }
    if (ok === null) {
      scheduleRetry();
      return;
    }
  }
  connect();
}

function connect() {
  if (!state.token || socket) return;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${scheme}://${location.host}/app/ws?token=${encodeURIComponent(state.token)}`);
  socket = ws;
  ws.addEventListener("open", () => {
    retries = 0;
    state.connected = true;
    state.wasConnected = true;
    ws.send(JSON.stringify(/** @type {ClientMessage} */ ({ a: "hello" })));
    draw();
  });
  ws.addEventListener("message", (event) => onMessage(String(event.data)));
  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    state.connected = false;
    if (event.code === CLOSE_SESSION_EXPIRED) state.token = null;
    draw();
    scheduleRetry();
  });
}

function scheduleRetry() {
  if (retryTimer || state.error) return;
  const delay = Math.min(10_000, 800 * 2 ** retries);
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void start();
  }, delay);
}

function onMessage(/** @type {string} */ raw) {
  /** @type {ServerMessage} */
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.t === "view") {
    state.clockOffset = message.now - Date.now();
    const before = state.view;
    state.view = message.view;
    const page = pages.get(message.view.room.game);
    state.fx = typeof page === "object" ? react(page, before, message.view) : null;
    draw();
    state.fx = null;
  } else if (message.t === "toast") {
    toast(message.text);
  } else if (message.t === "gone") {
    state.error = "room";
    socket?.close();
    draw();
  }
}

/** @param {ClientMessage} message */
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) {
    toast(strings().offline);
    return false;
  }
  socket.send(JSON.stringify(message));
  tg?.HapticFeedback.impactOccurred("light");
  return true;
}

/** After a game ends, move this page over to the group's new game. */
function joinNextRoom() {
  const next = state.view?.room.next;
  if (!next) return;
  state.room = next;
  state.token = null;
  state.view = null;
  const old = socket;
  socket = null;
  old?.close();
  draw();
  void start();
}

// ---------------------------------------------------------------- setup

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!composer || !text) return;
  if (send(composer.toMessage(text))) {
    els.input.value = "";
    els.input.focus();
  }
});

function applyTheme() {
  const root = document.documentElement;
  root.dataset.scheme = tg?.colorScheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  // The page uses Telegram's grouped-list colours: secondary background behind, section colour on cards.
  // Some themes make the two the same; then the cards get a tint of their own so they don't vanish.
  const theme = tg?.themeParams ?? {};
  const page = theme.secondary_bg_color?.toLowerCase();
  const section = (theme.section_bg_color ?? theme.bg_color)?.toLowerCase();
  root.classList.toggle("flat-sections", !!page && page === section);
}

if (tg) {
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast("6.1")) {
    tg.setHeaderColor("secondary_bg_color");
    tg.setBackgroundColor("secondary_bg_color");
  }
  if (tg.isVersionAtLeast("7.10")) tg.setBottomBarColor?.("secondary_bg_color");
  // A swipe down to scroll the feed shouldn't close the game.
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes?.();
  tg.onEvent("themeChanged", () => {
    applyTheme();
    draw();
  });
  tg.onEvent("activated", () => {
    if (!socket) void start();
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !socket) void start();
});
window.addEventListener("online", () => {
  if (!socket) void start();
});

applyTheme();
draw();
setInterval(tick, 250);
void start();

