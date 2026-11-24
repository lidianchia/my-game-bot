import { describe, expect, it } from "vitest";
import { commandMenu } from "../../src/core/commands";
import type { Room } from "../../src/core/rooms";
import { GAMES } from "../../src/games";
import { templateGame } from "../../src/games/_template";
import { TIMING, type HiLoSettings, type HiLoState } from "../../src/games/_template/types";
import type { HiLoTurnView, HiLoView } from "../../src/games/_template/view-types";
import { alice, bob, carol, createHarness, inviteCommand, personById, type Harness, type Person } from "../helpers/harness";

/**
 * The template game end to end, through the same doors the bot uses: chat
 * commands and buttons (h.command, h.press) and the game page (h.view is what a
 * person's page shows, h.web is a tap in it). A new game copies this file along
 * with src/games/_template.
 */

// The template isn't in GAMES, so its tests hand it to the harness. A registered game drops this:
// createHarness() offers the real list.
const newHarness = () => createHarness({ games: [...GAMES, templateGame] });

function room(h: Harness): Room<HiLoSettings, HiLoState> {
  return h.room() as unknown as Room<HiLoSettings, HiLoState>;
}

/** What `person`'s page shows of the game. */
function game(h: Harness, person: Person): HiLoView {
  const view = h.view(person);
  if (!view?.game) throw new Error(`no game view for ${person.firstName}`);
  return view.game as HiLoView;
}

function turn(h: Harness, person: Person): HiLoTurnView {
  const current = game(h, person).turn;
  if (!current) throw new Error("no turn");
  return current;
}

/** A tap in `person`'s page on the turn in play; resolves to the notice they'd see, if any. */
function act(h: Harness, person: Person, op: string, fields: Record<string, unknown> = {}) {
  return h.web(person, { a: "g", op, turn: room(h).state?.turn?.no ?? 0, ...fields });
}

/** Who leads the turn in play, and everyone else in the game. */
function cast(h: Harness, players: Person[]): { lead: Person; others: Person[] } {
  const leadId = room(h).state!.turn!.leadId;
  return { lead: personById(leadId), others: players.filter((person) => person.id !== leadId) };
}

/** Alice opens a room, invites `others` (who accept), and starts it from the page. */
async function start(h: Harness, others: Person[]): Promise<void> {
  await h.command(alice, "/play _template");
  const { text, textMentions } = inviteCommand(others);
  await h.command(alice, text, { textMentions });
  const invite = h.tg.findWithButton("接受")!;
  for (const person of others) await h.press(person, invite.id, "接受");
  expect(await h.web(alice, { a: "start" })).toBeNull();
  expect(room(h).status).toBe("playing");
}

describe("the template game", () => {
  it("lists its settings once: the page's rows and the room message's panel both come from them", async () => {
    const h = newHarness();
    await h.command(alice, "/play _template");
    expect(h.room().game).toBe("_template");
    expect(h.view(alice)!.room.game).toBe("_template"); // the page loads games/_template.js from this
    expect(h.view(alice)!.room.options.map((row) => row.label)).toEqual(["主角", "猜的时间"]);

    await h.press(alice, h.room().messageId, "设置");
    expect(h.tg.labels(h.room().messageId)).toEqual(expect.arrayContaining(["✓ 每人 1 次", "每人 2 次", "✓ 猜 30 秒", "猜 60 秒"]));
    await h.press(alice, h.room().messageId, "每人 2 次");
    expect(await h.web(alice, { a: "set", key: "s", value: "60" })).toBeNull();
    expect(room(h).settings).toEqual({ rounds: 2, seconds: 60 });
    expect(h.roomMessage().text).toContain("每人当 2 次主角");
    // A value that isn't on offer changes nothing.
    expect(await h.web(alice, { a: "set", key: "r", value: "9" })).toBeNull();
    expect(room(h).settings.rounds).toBe(2);
  });

  it("keeps the lead's number from everyone else until the turn is over", async () => {
    const h = newHarness();
    await start(h, [bob, carol]);
    const { lead, others } = cast(h, [alice, bob, carol]);
    const [first, second] = others as [Person, Person];
    expect(turn(h, lead)).toMatchObject({ role: "lead", phase: "picking" });
    expect(await act(h, first, "pick", { number: 5 })).toBe("只有主角能选数字");
    expect(await act(h, lead, "pick", { number: 9 })).toBe("选 1 到 6 之间的数字");
    expect(await act(h, lead, "pick", { number: 5 })).toBeNull();

    expect(turn(h, lead)).toMatchObject({ phase: "guessing", number: 5 });
    expect(turn(h, first)).toMatchObject({ role: "guesser", number: null });
    expect(await act(h, first, "guess", { side: "high" })).toBeNull();
    // Calls stay hidden too: the others see that someone called, not what.
    expect(turn(h, second).guessers.find((guesser) => guesser.id === first.id)).toMatchObject({ guessed: true, side: null });
    expect(await act(h, second, "guess", { side: "low" })).toBeNull();

    // Everyone called, so the turn is over and it's all out.
    expect(turn(h, first)).toMatchObject({ phase: "done", number: 5 });
    expect(room(h).state!.scores).toMatchObject({ [first.id]: 1, [second.id]: 0, [lead.id]: 1 });
    expect(turn(h, first).points.map((entry) => entry.points)).toEqual([1, 1]);
  });

  it("refuses taps for an old turn and from people outside the game", async () => {
    const h = newHarness();
    await start(h, [bob]);
    const { lead } = cast(h, [alice, bob]);
    expect(await h.web(lead, { a: "g", op: "pick", turn: 99, number: 3 })).toBe("这一步已经过去了");
    await act(h, lead, "pick", { number: 3 });
    expect(await act(h, carol, "guess", { side: "low" })).toBe("你不在这一局里，只能看");
    expect(await act(h, lead, "next")).toBe("这一轮还没结束");
  });

  it("moves on by itself when people run out of time", async () => {
    const h = newHarness();
    await start(h, [bob]);
    const { lead } = cast(h, [alice, bob]);
    h.advance(TIMING.pickMs);
    await h.fireAlarm();
    expect(room(h).state!.turn).toMatchObject({ phase: "done", skipReason: "idle" });
    h.advance(TIMING.revealMs);
    await h.fireAlarm();
    expect(room(h).state!.turn).toMatchObject({ no: 2, phase: "picking" });
    expect(room(h).state!.turn!.leadId).not.toBe(lead.id);
  });

  it("doesn't wait for a guesser who left, and ends the turn when its lead leaves", async () => {
    const h = newHarness();
    await start(h, [bob, carol]);
    const { lead, others } = cast(h, [alice, bob, carol]);
    const [stays, goes] = others as [Person, Person];
    await act(h, lead, "pick", { number: 1 });
    await act(h, stays, "guess", { side: "low" });
    await h.press(goes, h.room().messageId, "退出");
    expect(room(h).state!.turn).toMatchObject({ phase: "done", skipReason: null });
    expect(room(h).state!.scores[stays.id]).toBe(1);

    await act(h, stays, "next");
    const next = cast(h, [alice, bob, carol].filter((person) => person.id !== goes.id));
    await h.press(next.lead, h.room().messageId, "退出");
    expect(room(h).state!.turn).toMatchObject({ phase: "done", skipReason: "left" });
  });

  it("ends itself once everyone has led, and reports in the group", async () => {
    const h = newHarness();
    await start(h, [bob]);
    for (let no = 1; no <= 2; no++) {
      const { lead, others } = cast(h, [alice, bob]);
      await act(h, lead, "pick", { number: 2 });
      await act(h, others[0]!, "guess", { side: "low" });
      expect(game(h, lead).last).toBe(no === 2);
      await act(h, lead, "next");
    }
    expect(room(h).status).toBe("ended");
    expect(room(h).endReason).toBe("finished");
    expect(h.tg.find("房间 #1 结束")?.text).toContain("Alice　+1 分");
    expect(h.view(alice)!.room.status).toBe("ended");

    await h.command(alice, "/log");
    expect(h.tg.last().text).toContain("选了 2");
    await h.command(alice, "/stats");
    expect(h.tg.last().text).toContain("<b>猜大小 · 历史统计</b> · 1 局 2 轮");
  });

  it("answers a press on a chat game button with a pointer to the page", async () => {
    const h = newHarness();
    await start(h, [bob]);
    expect((await h.pressData(bob, h.room().messageId!, `r${h.room().id}:g:x`))?.text).toBe("这个游戏在「打开游戏」里玩");
  });

  it("shows up in the command menu, /help and the welcome once it's in the list", async () => {
    const games = [...GAMES, templateGame];
    expect(commandMenu(games, "zh")).toContainEqual({ command: "_template", description: "开一局猜大小（模板游戏）" });
    const h = newHarness();
    await h.command(alice, "/help");
    expect(h.tg.last().text).toContain("/_template 猜大小（模板游戏）");
  });
});
