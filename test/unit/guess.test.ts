import { describe, expect, it } from "vitest";
import type { Room } from "../../src/core/rooms";
import { roomLog } from "../../src/core/turn-log";
import { CARDS } from "../../src/games/guess/content/cards";
import { drawCard } from "../../src/games/guess/deck";
import {
  autoRemovals,
  bannedTermIn,
  cleanInput,
  containsTerm,
  isAnswer,
  revealsAnswer,
  sameWord,
} from "../../src/games/guess/normalize";
import { TIMING, type DrawnCard, type GuessSettings, type GuessState, type TurnRecord } from "../../src/games/guess/types";
import type { GuessView, TabooView, UniqueView } from "../../src/games/guess/view-types";
import { alice, bob, carol, createHarness, dave, erin, inviteCommand, type Harness, type Person } from "../helpers/harness";

// ------------------------------------------------------------------ helpers

function room(h: Harness): Room<GuessSettings, GuessState> {
  return h.room() as unknown as Room<GuessSettings, GuessState>;
}

function game(h: Harness, person: Person): GuessView {
  const view = h.view(person);
  if (!view?.game) throw new Error(`no game view for ${person.firstName}`);
  return view.game as GuessView;
}

function taboo(h: Harness, person: Person): TabooView {
  const turn = game(h, person).turn;
  if (turn?.mode !== "taboo") throw new Error("not an Off-limits turn");
  return turn;
}

function unique(h: Harness, person: Person): UniqueView {
  const turn = game(h, person).turn;
  if (turn?.mode !== "unique") throw new Error("not a Unique Clues turn");
  return turn;
}

/** A game-page tap on the turn in play. */
function act(h: Harness, person: Person, op: string, fields: Record<string, unknown> = {}) {
  return h.web(person, { a: "g", op, turn: room(h).state?.turn?.no ?? 0, ...fields });
}

function scores(h: Harness): Record<string, number> {
  return room(h).state!.scores;
}

/** Alice opens a /guess room, invites `others` (who accept), picks settings, and starts from the page. */
async function guessGame(
  h: Harness,
  others: Person[],
  settings: { mode?: "taboo" | "unique" | "mix"; rounds?: number } = {},
): Promise<void> {
  await h.command(alice, "/guess");
  const { text, textMentions } = inviteCommand(others);
  await h.command(alice, text, { textMentions });
  const invite = h.tg.findWithButton("接受")!;
  for (const person of others) await h.press(person, invite.id, "接受");
  const id = h.room().id;
  if (settings.mode) await h.pressData(alice, h.room().messageId!, `r${id}:st:m:${settings.mode}`);
  if (settings.rounds) await h.pressData(alice, h.room().messageId!, `r${id}:st:r:${settings.rounds}`);
  expect(await h.web(alice, { a: "start" })).toBeNull();
  expect(room(h).status).toBe("playing");
}

const NOT_A_WORD = "完全猜不着的东西";

// -------------------------------------------------------------- the room

describe("opening a game", () => {
  it("/guess opens a room whose message links to the game page", async () => {
    const h = createHarness();
    await h.command(alice, "/guess");
    expect(h.room().game).toBe("guess");
    expect(h.roomMessage().text).toContain("心照不宣");
    const open = h.roomMessage().keyboard.flat().find((key) => key.text === "打开游戏") as { url?: string } | undefined;
    expect(open?.url).toBe(`https://t.me/TestGameBot/play?startapp=g1001234567890r${h.room().id}`);
    // Truth or Dare stays a chat game: no page link.
    const tod = createHarness();
    await tod.command(alice, "/play");
    expect(tod.roomMessage().keyboard.flat().some((key) => key.text === "打开游戏")).toBe(false);
  });

  it("explains what's missing when the bot has no Mini App yet", async () => {
    const h = createHarness({ webAppName: null });
    await h.command(alice, "/guess");
    expect(h.sql.first("SELECT 1 AS yes FROM rooms")).toBeUndefined();
    expect(h.tg.last().text).toContain("MINIAPP_SHORT_NAME");
  });

  it("lets group members open the page and keeps everyone else out", async () => {
    const h = createHarness();
    await h.command(alice, "/guess");
    expect(await h.webJoin(bob)).toEqual({ ok: true });
    h.tg.outsiders.add(dave.id);
    expect(await h.webJoin(dave)).toEqual({ ok: false, reason: "member" });
    expect(await h.webJoin(bob, 999)).toEqual({ ok: false, reason: "room" });
    const tod = createHarness();
    await tod.command(alice, "/play");
    expect(await tod.webJoin(bob)).toEqual({ ok: false, reason: "room" }); // chat games have no page
  });

  it("people ask to join from the page and the host approves there", async () => {
    const h = createHarness();
    await h.command(alice, "/guess");
    await h.webJoin(bob);
    expect(h.view(bob)!.me).toMatchObject({ isPlayer: false, isHost: false, requested: false });
    expect(await h.web(bob, { a: "join" })).toBe("已申请，等房主同意");
    expect(h.view(bob)!.me.requested).toBe(true);
    expect(h.view(bob)!.room.requests).toEqual([]); // only the host sees requests
    const [request] = h.view(alice)!.room.requests;
    expect(request?.user.name).toBe("Bob");
    expect(await h.web(bob, { a: "approve", request: request!.id })).toBe("只有房主能这么做");
    expect(await h.web(alice, { a: "approve", request: request!.id })).toBeNull();
    expect(h.view(bob)!.me.isPlayer).toBe(true);
    expect(h.view(alice)!.room.players.map((player) => player.name)).toEqual(["Alice", "Bob"]);
    // The group sees it too: the request message was resolved.
    expect(h.tg.find("加入了房间")).toBeDefined();
  });

  it("lets the host change settings from the lobby page", async () => {
    const h = createHarness();
    await h.command(alice, "/guess");
    const rows = () => h.view(alice)!.room.options;
    const picked = () => Object.fromEntries(rows().map((row) => [row.key, row.options.find((option) => option.on)?.value]));
    expect(rows().map((row) => row.label)).toEqual(["玩法", "每人当主角", "禁词每轮"]);
    expect(picked()).toEqual({ m: "mix", r: "1", s: "90" });

    expect(await h.web(alice, { a: "set", key: "r", value: "2" })).toBeNull();
    expect(await h.web(alice, { a: "set", key: "s", value: "60" })).toBeNull();
    expect(room(h).settings).toMatchObject({ rounds: 2, seconds: 60 });
    expect(h.roomMessage().text).toContain("每人当 2 次主角"); // the group's room message follows along
    // Values that aren't on offer change nothing.
    expect(await h.web(alice, { a: "set", key: "r", value: "9" })).toBeNull();
    expect(room(h).settings.rounds).toBe(2);

    // Only Off-limits has a turn length, so playing Unique Clues alone drops that row.
    await h.web(alice, { a: "set", key: "m", value: "unique" });
    expect(rows().map((row) => row.key)).toEqual(["m", "r"]);

    // Everyone sees the same rows; only the host may change them, and only before the game starts.
    await h.webJoin(bob);
    expect(h.view(bob)!.room.options).toEqual(rows());
    expect(await h.web(bob, { a: "set", key: "m", value: "mix" })).toBe("只有房主能这么做");
    expect(room(h).settings.mode).toBe("unique");
  });

  it("stops offering settings once the game is on", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol]);
    expect(h.view(alice)!.room.options).toEqual([]);
    expect(await h.web(alice, { a: "set", key: "r", value: "3" })).toBe("这个按钮已经过期了");
    expect(room(h).settings.rounds).toBe(1);
  });

  it("needs three players and only the host can start", async () => {
    const h = createHarness();
    await h.command(alice, "/guess");
    const { text, textMentions } = inviteCommand([bob]);
    await h.command(alice, text, { textMentions });
    await h.press(bob, h.tg.findWithButton("接受")!.id, "接受");
    expect(await h.web(alice, { a: "start" })).toBe("至少要 3 个人才能开始");
    const more = inviteCommand([carol]);
    await h.command(alice, more.text, { textMentions: more.textMentions });
    await h.press(carol, h.tg.findWithButton("接受")!.id, "接受");
    expect(await h.web(bob, { a: "start" })).toBe("只有房主能这么做");
    expect(await h.web(alice, { a: "start" })).toBeNull();
    expect(room(h).status).toBe("playing");
    expect(h.view(bob)!.room.status).toBe("playing");
  });
});

// ------------------------------------------------------------ Off-limits

describe("Off-limits", () => {
  it("plays a describing turn: guesses, a foul, a slip, a skip, then time runs out", async () => {
    const h = createHarness({ seed: 11 });
    await guessGame(h, [bob, carol], { mode: "taboo" });

    // Turn 1 is Alice's (first to join); nothing is dealt until she starts.
    expect(taboo(h, alice)).toMatchObject({ role: "lead", phase: "ready", card: null });
    expect(taboo(h, bob)).toMatchObject({ role: "player", phase: "ready", card: null });
    expect(await act(h, bob, "begin")).toBe("只有描述的人能这么做");
    expect(await act(h, alice, "begin")).toBeNull();

    const first = taboo(h, alice).card!;
    expect(first.word).toBeTruthy();
    expect(first.taboo).toHaveLength(4);
    expect(taboo(h, bob).card).toEqual({ ref: 0, word: null, taboo: [] });
    expect(JSON.stringify(h.view(bob))).not.toContain(first.word!);

    // A miss shows up for everyone; the describer can't guess.
    await act(h, bob, "guess", { card: 0, text: NOT_A_WORD });
    expect(taboo(h, carol).feed.at(-1)).toMatchObject({ kind: "guess", whoId: bob.id, who: "Bob", text: NOT_A_WORD });
    expect(await act(h, alice, "guess", { card: 0, text: first.word })).toBe("你在描述，不能猜");

    // Carol gets it: both she and Alice score, and the next word is dealt.
    await act(h, carol, "guess", { card: 0, text: ` ${first.word}！` });
    expect(scores(h)).toMatchObject({ [alice.id]: 1, [carol.id]: 1, [bob.id]: 0 });
    expect(taboo(h, bob).feed.at(-1)).toMatchObject({ kind: "correct", who: "Carol", word: first.word });
    expect(taboo(h, alice).card!.ref).toBe(1);
    expect(await act(h, bob, "guess", { card: 0, text: "late" })).toBe("这个词已经过去了");

    // Bob calls a foul on word 2: Alice loses a point.
    expect(await act(h, alice, "buzz", { card: 1 })).toBe("你自己在描述");
    await act(h, bob, "buzz", { card: 1 });
    expect(scores(h)[alice.id]).toBe(0);

    // Alice types an off-limits word as a hint on word 3: an automatic foul.
    const third = taboo(h, alice).card!;
    await act(h, alice, "hint", { card: 2, text: `想想${third.taboo[0]}` });
    expect(scores(h)[alice.id]).toBe(-1);
    expect(taboo(h, carol).feed.at(-1)).toMatchObject({ kind: "slip", word: third.word });

    // An innocent hint just goes in the feed.
    await act(h, alice, "hint", { card: 3, text: "嗯嗯嗯" });
    expect(taboo(h, bob).feed.at(-1)).toMatchObject({ kind: "hint", text: "嗯嗯嗯" });
    await act(h, alice, "skip", { card: 3 });

    // Time's up: the word in play is recorded as unfinished.
    h.advance(room(h).settings.seconds * 1000);
    await h.fireAlarm();
    const done = taboo(h, bob);
    expect(done.phase).toBe("done");
    expect(done.results.map((result) => result.outcome)).toEqual(["guessed", "buzzed", "slipped", "skipped", "timeout"]);
    expect(done.results[0]).toMatchObject({ word: first.word, by: "Carol" });
    expect(done.points).toEqual([
      { id: carol.id, name: "Carol", points: 1 },
      { id: alice.id, name: "Alice", points: -1 },
    ]);

    // Moving on logs the turn and hands the next turn to Bob.
    await act(h, carol, "next");
    expect(taboo(h, bob)).toMatchObject({ role: "lead", phase: "ready", no: 2 });
    const records = roomLog<TurnRecord>(h.sql, room(h).id, "turn").map((entry) => entry.data);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ mode: "taboo", leadId: alice.id, points: { [alice.id]: -1, [carol.id]: 1 } });
  });

  it("skips a describer who never starts", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol], { mode: "taboo" });
    h.advance(TIMING.readyMs);
    await h.fireAlarm();
    expect(taboo(h, bob)).toMatchObject({ phase: "done", skipReason: "idle", results: [] });
  });

  it("refuses taps for an old turn and from people outside the game", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol], { mode: "taboo" });
    expect(await h.web(alice, { a: "g", op: "begin", turn: 99 })).toBe("这一步已经过去了");
    await h.webJoin(dave);
    expect(taboo(h, dave).role).toBe("watcher");
    expect(await act(h, dave, "buzz", { card: 0 })).toBe("你不在这一局里，只能看");
    expect(await act(h, dave, "next")).toBe("这一轮还没结束");
  });
});

// ---------------------------------------------------------- Unique Clues

describe("Unique Clues", () => {
  async function writeClues(h: Harness, clues: Array<[Person, string]>) {
    for (const [person, text] of clues) expect(await act(h, person, "clue", { text })).toBeNull();
  }

  it("cancels clashing clues, hides everything from the guesser until it's time, and scores a right guess", async () => {
    const h = createHarness({ seed: 4 });
    await guessGame(h, [bob, carol, dave, erin], { mode: "unique" });

    const word = unique(h, bob).word!;
    expect(word).toBeTruthy();
    expect(unique(h, alice)).toMatchObject({ role: "lead", phase: "writing", word: null, clues: null });
    expect(JSON.stringify(h.view(alice))).not.toContain(word);

    expect(await act(h, alice, "clue", { text: "x" })).toBe("这一轮你不用写线索");
    expect(await act(h, bob, "clue", { text: "两 个词" })).toBe("线索只能是一个词，不能有空格");
    await writeClues(h, [
      [bob, "线索甲"],
      [carol, "线索甲"], // the same clue: both cancel
      [dave, "线索丙"],
    ]);
    // Writers don't see each other's clues while writing.
    expect(unique(h, bob)).toMatchObject({ clues: null, myClue: "线索甲" });
    expect(unique(h, alice).writers.map((writer) => writer.wrote)).toEqual([true, true, true, false]);

    await writeClues(h, [[erin, "线索乙"]]); // last one in: on to the review
    const review = unique(h, bob);
    expect(review.phase).toBe("reviewing");
    expect(review.clues!.map((clue) => [clue.name, clue.removed])).toEqual([
      ["Bob", "duplicate"],
      ["Carol", "duplicate"],
      ["Dave", null],
      ["Erin <&>", null],
    ]);
    expect(unique(h, alice).clues).toBeNull();
    expect(JSON.stringify(h.view(alice))).not.toContain("线索乙");

    // Striking toggles; automatically removed clues stay out.
    await act(h, bob, "strike", { writer: erin.id });
    expect(unique(h, carol).clues!.at(-1)).toMatchObject({ removed: "struck", struckByMe: false });
    expect(unique(h, bob).clues!.at(-1)).toMatchObject({ struckByMe: true });
    await act(h, bob, "strike", { writer: erin.id });
    expect(unique(h, carol).clues!.at(-1)!.removed).toBeNull();
    expect(await act(h, carol, "strike", { writer: bob.id })).toBe("这条已经去掉了");
    await act(h, carol, "strike", { writer: dave.id }); // "means the same as Erin's"

    for (const person of [bob, carol, dave]) await act(h, person, "confirm");
    expect(unique(h, alice).phase).toBe("reviewing");
    await act(h, erin, "confirm");

    // The guesser sees only the clue left standing.
    const guessing = unique(h, alice);
    expect(guessing).toMatchObject({ phase: "guessing", word: null });
    expect(guessing.clues).toEqual([{ writer: erin.id, name: "Erin <&>", text: "线索乙", removed: null, struckByMe: false }]);
    expect(JSON.stringify(h.view(alice))).not.toContain(word);

    expect(await act(h, bob, "guess", { text: word })).toBe("只有猜的人能这么做");
    await act(h, alice, "guess", { text: word });
    const done = unique(h, alice);
    expect(done).toMatchObject({ phase: "done", outcome: "correct", word, guess: word });
    expect(done.clues).toHaveLength(4); // everything is revealed afterwards
    expect(scores(h)).toMatchObject({ [alice.id]: 2, [erin.id]: 1, [bob.id]: 0, [carol.id]: 0, [dave.id]: 0 });
  });

  it("drops clues that give the answer away, skips a pointless review, and lets the host count a near-miss", async () => {
    const h = createHarness({ seed: 9 });
    await guessGame(h, [bob, carol], { mode: "unique" });
    const word = unique(h, bob).word!;
    await writeClues(h, [
      [bob, "线索一"],
      [carol, `${word}们`], // contains the answer
    ]);
    // One clue left standing: nothing to compare, so straight to the guess, without the giveaway.
    expect(unique(h, alice)).toMatchObject({ phase: "guessing", clues: [{ text: "线索一", removed: null }] });
    expect(JSON.stringify(h.view(alice))).not.toContain(word);
    expect(unique(h, bob).clues!.map((clue) => clue.removed)).toEqual([null, "answer"]);

    await act(h, alice, "guess", { text: NOT_A_WORD });
    expect(unique(h, bob)).toMatchObject({ outcome: "wrong", points: [] });
    expect(await act(h, bob, "accept")).toBe("只有房主能这么做");
    await act(h, alice, "accept"); // Alice hosts (and guessed; the group trusts its host)
    expect(unique(h, bob)).toMatchObject({ outcome: "correct", accepted: true });
    expect(scores(h)).toMatchObject({ [alice.id]: 2, [bob.id]: 1, [carol.id]: 0 });
    expect(await act(h, alice, "accept")).toBe("只有猜错的才能改判");
    await act(h, alice, "next");
    const [record] = roomLog<TurnRecord>(h.sql, room(h).id, "turn").map((entry) => entry.data);
    expect(record).toMatchObject({ mode: "unique", outcome: "correct", accepted: true, guess: NOT_A_WORD });
  });

  it("moves on by itself when people run out of time", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol, dave], { mode: "unique" });
    await writeClues(h, [
      [bob, "线索"],
      [carol, "另一条"],
    ]); // Dave never writes
    h.advance(TIMING.writeMs);
    await h.fireAlarm();
    expect(unique(h, bob).phase).toBe("reviewing");
    h.advance(TIMING.reviewMs);
    await h.fireAlarm();
    expect(unique(h, alice)).toMatchObject({ phase: "guessing", clues: [{ text: "线索" }, { text: "另一条" }] });
    h.advance(TIMING.guessMs);
    await h.fireAlarm();
    expect(unique(h, alice)).toMatchObject({ phase: "done", outcome: "timeout" });
  });

  it("doesn't wait for a writer who left", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol], { mode: "unique" });
    await writeClues(h, [[bob, "线索"]]);
    await h.press(carol, h.room().messageId, "退出");
    expect(unique(h, alice).phase).toBe("guessing"); // Bob alone: nothing to review
  });
});

// ------------------------------------------------------------ whole games

describe("a whole game", () => {
  it("alternates modes, rotates the lead, ends itself and reports", async () => {
    const h = createHarness({ seed: 2 });
    await guessGame(h, [bob, carol]); // default: both modes alternating, one lead each
    const leads: string[] = [];
    const modes: string[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      const view = game(h, alice);
      leads.push(view.turn!.lead.name);
      modes.push(view.turn!.mode);
      expect(view.progress).toEqual({ no: turn, total: 3 });
      await h.press(alice, h.room().messageId, "跳过本轮"); // host skips: fastest way through
      expect(game(h, alice).last).toBe(turn === 3);
      if (turn < 3) await act(h, bob, "next");
    }
    expect(leads).toEqual(["Alice", "Bob", "Carol"]);
    expect(modes).toEqual(["taboo", "unique", "taboo"]);

    await act(h, bob, "next"); // "Finish and see the summary"
    expect(room(h)).toMatchObject({ status: "ended", endReason: "finished" });
    expect(h.tg.find("心照不宣 · 房间")?.text).toContain("结束");
    expect(h.view(bob)!.room.endReason).toBe("全部轮完了");
    expect(roomLog(h.sql, room(h).id, "turn")).toHaveLength(3);
  });

  it("closes a minute after the last turn if nobody moves on", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol], { mode: "taboo" });
    for (let turn = 1; turn <= 3; turn++) {
      await h.press(alice, h.room().messageId, "跳过本轮");
      if (turn < 3) await act(h, alice, "next");
    }
    h.advance(TIMING.wrapUpMs);
    await h.fireAlarm();
    expect(room(h).status).toBe("ended");
  });

  it("aborts the turn when its lead leaves, and points already won stand", async () => {
    const h = createHarness();
    await guessGame(h, [bob, carol, dave], { mode: "taboo" });
    await act(h, alice, "begin");
    const word = taboo(h, alice).card!.word!;
    await act(h, bob, "guess", { card: 0, text: word });
    await h.press(alice, h.room().messageId, "退出");
    expect(taboo(h, bob)).toMatchObject({ phase: "done", skipReason: "left" });
    expect(scores(h)).toMatchObject({ [alice.id]: 1, [bob.id]: 1 });
  });

  it("/log and /stats include the word game", async () => {
    const h = createHarness({ seed: 6 });
    await guessGame(h, [bob, carol], { mode: "taboo", rounds: 1 });
    await act(h, alice, "begin");
    const word = taboo(h, alice).card!.word!;
    await act(h, carol, "guess", { card: 0, text: word });
    await h.command(alice, "/end");
    await h.command(alice, "/log");
    const log = h.tg.find("心照不宣 · 房间")!.text;
    expect(log).toContain(`${word} ✓（Carol）`);
    await h.command(alice, "/stats");
    const stats = h.tg.find("心照不宣 · 历史统计")!.text;
    expect(stats).toContain("Carol");
    expect(stats).toContain("描述成功 1");
  });
});

// ------------------------------------------------------- word matching

describe("word matching", () => {
  const card = (word: string, taboo: string[] = [], alt: string[] = []): DrawnCard => ({ id: "t", word, taboo, alt });

  it("treats case, spacing, punctuation, full-width forms and plurals as the same word", () => {
    expect(sameWord("Apples!", "apple")).toBe(true);
    expect(sameWord("horses", "horse")).toBe(true);
    expect(sameWord("buses", "bus")).toBe(true);
    expect(sameWord("glasses", "glass")).toBe(true);
    expect(sameWord("cities", "city")).toBe(true);
    expect(sameWord("ice-cream", "Ice Cream")).toBe(true);
    expect(sameWord("icecream", "ice cream")).toBe(true);
    expect(sameWord("火 车。", "火车")).toBe(true);
    expect(sameWord("ＡＰＰＬＥ", "apple")).toBe(true);
    expect(sameWord("apple", "pineapple")).toBe(false);
    expect(sameWord("火车", "火车站")).toBe(false);
    expect(sameWord("", "")).toBe(false);
  });

  it("accepts listed alternatives as answers", () => {
    const bike = card("自行车", [], ["单车", "脚踏车"]);
    expect(isAnswer("单车", bike)).toBe(true);
    expect(isAnswer("摩托车", bike)).toBe(false);
  });

  it("finds off-limits words inside a hint: Chinese by characters, English by whole words", () => {
    const apple = card("苹果", ["水果", "红色", "手机", "牛顿"]);
    expect(bannedTermIn("一种红色的东西", apple)).toBe("红色");
    expect(bannedTermIn("苹果树上长的", apple)).toBe("苹果");
    expect(bannedTermIn("圆圆的，很甜", apple)).toBeNull();
    const english = card("apple", ["fruit", "red", "iPhone", "Newton"]);
    expect(bannedTermIn("Fruits that are RED", english)).toBe("fruit");
    expect(bannedTermIn("a pineapple is not it", english)).toBeNull();
    expect(bannedTermIn("think of newton's head", english)).toBe("Newton");
    expect(containsTerm("I love icecream", "ice cream")).toBe(true);
  });

  it("knows which clues give the answer away", () => {
    const train = card("火车", [], ["列车"]);
    expect(revealsAnswer("车", train)).toBe(true);
    expect(revealsAnswer("火车站", train)).toBe(true);
    expect(revealsAnswer("列车", train)).toBe(true);
    expect(revealsAnswer("铁轨", train)).toBe(false);
    expect(revealsAnswer("果园", card("苹果"))).toBe(false);
    expect(revealsAnswer("apples", card("apple"))).toBe(true);
    expect(revealsAnswer("pineapple", card("apple"))).toBe(false);
  });

  it("cancels every copy of a clash and leaves unique clues alone", () => {
    const removed = autoRemovals({ 1: "Rail", 2: "rails", 3: "steam", 4: "火车", 5: "smoke" }, card("火车"));
    expect(removed).toEqual({ 1: "duplicate", 2: "duplicate", 4: "answer" });
  });

  it("cleans typed input", () => {
    expect(cleanInput("  hello\n\tthere  ", 40)).toBe("hello there");
    expect(cleanInput("a".repeat(50), 40)).toHaveLength(40);
    expect(cleanInput("苹果".repeat(30), 5)).toBe("苹果苹果苹");
    expect(cleanInput(42, 40)).toBe("");
  });
});

// ------------------------------------------------------------------ deck

describe("the deck", () => {
  const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

  it("has well-formed bilingual cards", () => {
    expect(CARDS.length).toBeGreaterThanOrEqual(120);
    expect(new Set(CARDS.map((card) => card.id)).size).toBe(CARDS.length);
    for (const lang of ["zh", "en"] as const) {
      expect(new Set(CARDS.map((card) => card[lang].word.toLowerCase())).size).toBe(CARDS.length);
      for (const { id, [lang]: side } of CARDS) {
        const where = `${id} ${lang} ${side.word}`;
        expect(side.taboo, where).toHaveLength(4);
        expect(new Set(side.taboo).size, where).toBe(4);
        for (const term of [side.word, ...side.taboo, ...(side.alt ?? [])]) {
          expect(term.trim(), where).toBe(term);
          expect(term.length, where).toBeGreaterThan(0);
          expect(PICTOGRAPHIC.test(term), where).toBe(false);
        }
        // An off-limits word that contains the word would make the card unplayable.
        for (const term of side.taboo) expect(containsTerm(term, side.word) || containsTerm(side.word, term), `${where}: ${term}`).toBe(false);
        for (const alt of side.alt ?? []) expect(side.taboo.includes(alt), `${where}: ${alt}`).toBe(false);
      }
    }
  });

  it("doesn't repeat a card until the deck runs out", () => {
    const random = (() => {
      let state = 1;
      return () => ((state = (state * 48271) % 2147483647) / 2147483647);
    })();
    const used = new Set<string>();
    for (let index = 0; index < CARDS.length; index++) {
      const card = drawCard("zh", used, random);
      expect(used.has(card.id)).toBe(false);
      used.add(card.id);
    }
    expect(used.size).toBe(CARDS.length);
    expect(drawCard("en", used, random).word).toBeTruthy(); // starts over
  });
});
