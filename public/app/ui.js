// @ts-check

/** @typedef {Node | string | number | null | undefined | false} Child */

/**
 * Builds an element. Strings always become text nodes, never HTML, so names,
 * guesses and clues typed by players can't inject markup.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown> | null} [props] `class`, `on<event>` handlers, attributes (false/null/undefined skip, true = empty)
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    } else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/**
 * "1:05", "0:09"
 * @param {number} ms
 */
export function clock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Scores read better with a real minus sign.
 * @param {number} value
 */
export function score(value) {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/**
 * +2 / −1 for points won or lost in a turn.
 * @param {number} value
 */
export function delta(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

// -------------------------------------------------------------- avatars

/**
 * Avatar gradients in Telegram's own palette (red, orange, violet, green,
 * cyan, blue, pink), picked by user id so a person keeps their colour all game.
 */
const AVATAR_COLOURS = [
  ["#ff885e", "#ff516a"],
  ["#ffcd6a", "#ffa85c"],
  ["#82b1ff", "#665fff"],
  ["#a0de7e", "#54cb68"],
  ["#53edd6", "#28c9b7"],
  ["#72d5fd", "#2a9ef1"],
  ["#e0a2f3", "#d669ed"],
];

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * First letter of a name, as Telegram shows on an avatar without a photo.
 * @param {string} name
 */
export function initial(name) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = graphemes ? graphemes.segment(trimmed)[Symbol.iterator]().next().value?.segment : Array.from(trimmed)[0];
  return (first ?? "?").toUpperCase();
}

/**
 * A round avatar with the person's initial; `badge` sits on its corner (♛, ✓).
 * @param {{ id: number, name: string }} person
 * @param {number} size  px
 * @param {{ badge?: string, tone?: "host" | "done" }} [options]
 */
export function avatar(person, size, options = {}) {
  const [from, to] = AVATAR_COLOURS[Math.abs(person.id) % AVATAR_COLOURS.length] ?? ["#72d5fd", "#2a9ef1"];
  return h(
    "span",
    { class: "avatar", style: `--size:${size}px;--from:${from};--to:${to}`, "aria-hidden": "true" },
    initial(person.name),
    options.badge ? h("span", { class: `avatar-badge${options.tone ? ` ${options.tone}` : ""}` }, options.badge) : null,
  );
}

// ---------------------------------------------------------------- icons

/** Stroke icons; they take the text colour unless the CSS says otherwise. */
const ICONS = {
  /** Off-limits: a circle with a slash. */
  ban: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M5.6 18.4 18.4 5.6" stroke="currentColor" stroke-width="2.5"/></svg>',
  /** Secret: only some people can see this. */
  hidden:
    '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.4 3.7M6.6 6.6C4.6 7.9 3.2 9.9 2.5 12c1 2.8 4.5 7 9.5 7 1.7 0 3.2-.5 4.6-1.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

/**
 * @param {keyof typeof ICONS} name
 * @returns {Element}
 */
export function icon(name) {
  const template = document.createElement("template");
  template.innerHTML = ICONS[name]; // fixed markup above, never player text
  const svg = /** @type {Element} */ (template.content.firstElementChild);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  return svg;
}

// ----------------------------------------------------------------- ring

/** Circumference of the countdown ring (r = 19). */
export const RING_LENGTH = 2 * Math.PI * 19;

/**
 * The round countdown in the corner; main.js turns it a few times a second.
 * @param {number} endsAt  server clock
 * @param {number | null} span  the phase's full length (ms); without it the ring stays full
 */
export function ring(endsAt, span) {
  const template = document.createElement("template");
  template.innerHTML =
    '<div class="ring" role="timer"><svg viewBox="0 0 46 46" width="46" height="46" aria-hidden="true">' +
    '<circle class="ring-track" cx="23" cy="23" r="19"/>' +
    `<circle class="ring-bar" cx="23" cy="23" r="19" stroke-dasharray="${RING_LENGTH.toFixed(2)}" transform="rotate(-90 23 23)"/>` +
    '</svg><b class="ring-label"></b></div>';
  const element = /** @type {HTMLElement} */ (template.content.firstElementChild);
  element.dataset.ends = String(endsAt);
  if (span !== null) element.dataset.span = String(span);
  return element;
}
