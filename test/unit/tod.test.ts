import { describe, expect, it } from "vitest";
import type { JsonRequest, Llm } from "../../src/ai/llm";
import { roomLog } from "../../src/core/turn-log";
import type { TurnRecord } from "../../src/games/tod/types";
import {
  alice,
  bob,
  carol,
  createHarness,
  dave,
  personById,
  roomWith,
  type Harness,
  type Person,
} from "../helpers/harness";

const everyone = [alice, bob, carol];

function performerOf(h: Harness): Person {
  return personById(h.turn().playerId);
}

function votersOf(h: Harness, players: Person[] = everyone): Person[] {
  return players.filter((person) => person.id !== h.turn().playerId);
}

/** Performer picks truth/dare, says they're done, and every voter votes the same way. */
async function playTurn(h: Harness, choice: "真心话" | "大冒险", verdict: "✓ 过" | "✗ 不过", players: Person[] = everyone) {
  const performer = performerOf(h);
  const card = h.turnCard().id;
  await h.press(performer, card, choice);
  await h.press(performer, card, "做完了");
  for (const voter of votersOf(h, players)) await h.press(voter, card, verdict);
  return performer;
}

function records(h: Harness): TurnRecord[] {
  return roomLog<TurnRecord>(h.sql, h.room().id, "turn").map((entry) => entry.data);
}

function fakeLlm(questions: string[], options: { fail?: boolean } = {}) {
  const calls: JsonRequest[] = [];
  const llm: Llm = {
    providers: ["fake"],
    async json(request) {
      calls.push(request);
      if (options.fail) throw new Error("provider down");
      return { value: { question: questions[(calls.length - 1) % questions.length], type: "post" }, provider: "fake" };
    },
  };
  return { llm, calls };
}

describe("a round", () => {
  it("starts with the bottle picking someone, and only they can choose", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const room = h.room();
    expect(room.status).toBe("playing");
    expect(h.tg.pinned.has(room.messageId!)).toBe(true);
    expect(everyone.map((person) => person.id)).toContain(h.turn().playerId);

    const card = h.turnCard();
    expect(card.text).toContain("第 1 轮");
    expect(card.text).toContain(`tg://user?id=${h.turn().playerId}`);
    expect(h.tg.labels(card.id)).toEqual(["真心话", "大冒险"]);

    const bystander = votersOf(h)[0]!;
    expect((await h.press(bystander, card.id, "真心话"))?.text).toMatch(/^现在是 .+ 的回合$/);
    expect(h.turn().phase).toBe("choosing");
  });

  it("passes a truth on the group's vote, scores it and logs it", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const [first, second] = votersOf(h);
    const card = h.turnCard().id;

    await h.press(performer, card, "真心话");
    expect(h.turn().phase).toBe("performing");
    expect(h.turn().question?.from).toBe("deck");
    expect(h.tg.message(card).text).toContain("<blockquote>");
    expect(h.tg.labels(card)).toEqual(["做完了，开始投票", "↻ 换一题 · 剩 2", "怂了"]);

    await h.press(performer, card, "做完了");
    expect(h.turn().phase).toBe("voting");
    expect(h.tg.message(card).text).toContain("还没投");
    expect((await h.press(performer, card, "✓ 过"))?.text).toBe("不能给自己投票哦");

    await h.press(first!, card, "✓ 过");
    expect(h.turn().phase).toBe("voting");
    await h.press(second!, card, "✓ 过");

    const turn = h.turn();
    expect(turn.phase).toBe("done");
    expect(turn.outcome).toBe("pass");
    expect(h.room().state!.scores[performer.id]).toBe(1);
    expect(h.tg.message(card).text).toContain("✓ 过关");
    expect(h.tg.labels(card)).toEqual(["下一轮"]);
    expect(records(h)).toHaveLength(1);
    expect(records(h)[0]).toMatchObject({ playerId: performer.id, kind: "truth", outcome: "pass", points: 1 });
    expect(h.roomMessage().text).toContain(`#1 ${performer.firstName} 真心话 ✓ +1`);
  });

  it("turns a failed dare into a penalty that can't be chickened out of", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = await playTurn(h, "大冒险", "✗ 不过");
    const card = h.turnCard().id;

    expect(h.turn().outcome).toBe("fail");
    expect(h.turn().phase).toBe("penalty");
    expect(h.tg.message(card).text).toContain("惩罚题");
    expect(h.tg.labels(card)).toEqual(["做完了，开始投票"]);

    await h.press(performer, card, "做完了");
    for (const voter of votersOf(h)) await h.press(voter, card, "✓ 过");
    expect(h.turn()).toMatchObject({ phase: "done", penaltyOutcome: "pass", points: 0 });
    expect(h.tg.message(card).text).toContain("本轮合计 0 分");
  });

  it("charges two points plus a penalty for chickening out", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "大冒险");
    await h.press(performer, card, "怂了");
    expect(h.turn()).toMatchObject({ outcome: "chicken", phase: "penalty", points: -2 });
    expect(h.tg.message(card).text).toContain("怂了");

    await h.press(performer, card, "做完了");
    for (const voter of votersOf(h)) await h.press(voter, card, "✗ 不过");
    expect(h.turn()).toMatchObject({ phase: "done", penaltyOutcome: "fail", points: -3 });
    expect(h.room().state!.scores[performer.id]).toBe(-3);
  });

  it("counts a tied vote as a pass", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const [first, second] = votersOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "大冒险");
    await h.press(performer, card, "做完了");
    await h.press(first!, card, "✓ 过");
    await h.press(second!, card, "✗ 不过");
    expect(h.turn()).toMatchObject({ outcome: "pass", points: 2 });
  });

  it("lets voters change their mind before the vote closes", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const [first] = votersOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.press(performer, card, "做完了");
    await h.press(first!, card, "✓ 过");
    expect(h.tg.labels(card)).toEqual(["✓ 过 · 1", "✗ 不过 · 0"]);
    await h.press(first!, card, "✗ 不过");
    expect(h.tg.labels(card)).toEqual(["✓ 过 · 0", "✗ 不过 · 1"]);
  });

  it("closes the vote when time runs out", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const [first] = votersOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.press(performer, card, "做完了");
    expect(h.alarm).toBe(h.now() + 60_000);
    await h.press(first!, card, "✗ 不过");

    h.advance(59_000);
    await h.fireAlarm();
    expect(h.turn().phase).toBe("voting");
    h.advance(1_000);
    await h.fireAlarm();
    expect(h.turn()).toMatchObject({ outcome: "fail", phase: "penalty" });
  });

  it("limits free question swaps per player", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    const firstQuestion = h.turn().question!.text;
    const swapData = h.tg.buttonData(card, "换一题");
    await h.press(performer, card, "换一题 · 剩 2");
    expect(h.turn().question!.text).not.toBe(firstQuestion);
    await h.press(performer, card, "换一题 · 剩 1");
    expect(h.turn().rerolled).toHaveLength(2);
    expect(h.tg.labels(card)).toEqual(["做完了，开始投票", "怂了"]);
    expect((await h.pressData(performer, card, swapData))?.text).toBe("这局的换题次数用完了");
  });

  it("only lets the performer or the host start the vote", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    const outsider = votersOf(h).find((person) => person.id !== alice.id)!;
    expect((await h.press(outsider, card, "做完了"))?.text).toBe("只有本人或房主能点");
    await h.press(alice, card, "做完了"); // the host can always open it
    expect(h.turn().phase).toBe("voting");
  });

  it("moves on with 'next round' and retires the old card's button", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    await playTurn(h, "真心话", "✓ 过");
    const oldCard = h.turnCard().id;
    expect((await h.press(dave, oldCard, "下一轮"))?.text).toBe("你不在房间里");
    await h.press(bob, oldCard, "下一轮");
    expect(h.tg.message(oldCard).keyboard).toEqual([]);
    expect(h.turn().no).toBe(2);
    expect(h.turnCard().id).not.toBe(oldCard);
    expect(h.turnCard().text).toContain("第 2 轮");
  });

  it("ignores taps on cards from earlier rounds", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    const truthData = h.tg.buttonData(card, "真心话");
    await playTurn(h, "真心话", "✓ 过");
    await h.press(bob, card, "下一轮");
    expect((await h.pressData(performer, card, truthData))?.text).toBe("这一轮已经过去了");
  });
});

describe("people coming and going mid-game", () => {
  it("makes late joiners wait for the next vote", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.press(performer, card, "做完了");

    await h.press(dave, h.room().messageId, "申请加入");
    await h.press(alice, h.tg.findWithButton("同意")!.id, "同意");
    expect(h.players()).toContain(dave.id);
    expect((await h.press(dave, card, "✓ 过"))?.text).toBe("你是投票开始后才进来的，这轮不能投");
    expect(h.room().state!.scores[dave.id]).toBe(0);
  });

  it("voids the round when the player leaves", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "大冒险");
    await h.press(performer, h.room().messageId, "退出");
    expect(h.turn()).toMatchObject({ phase: "done", outcome: "skipped", skipReason: "left", points: 0 });
    expect(h.tg.message(card).text).toContain("离开了房间");
    expect(records(h)[0]).toMatchObject({ outcome: "skipped", skipReason: "left" });
  });

  it("closes the vote if the last undecided voter leaves", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const [first, second] = votersOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.press(performer, card, "做完了");
    await h.press(first!, card, "✓ 过");
    await h.press(second!, h.room().messageId, "退出");
    expect(h.turn()).toMatchObject({ phase: "done", outcome: "pass" });
  });

  it("lets the host skip a stuck round", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    expect((await h.press(bob, h.room().messageId, "跳过本轮"))?.text).toBe("只有房主能这么做");
    await h.press(alice, h.room().messageId, "跳过本轮");
    expect(h.turn()).toMatchObject({ phase: "done", outcome: "skipped", skipReason: "host" });
    expect(h.turnCard().text).toContain("房主跳过了这一轮");
    expect((await h.press(alice, h.room().messageId, "跳过本轮"))?.text).toBe("现在没有可以跳过的回合");
  });
});

describe("ending a game", () => {
  it("posts a summary, unpins the board and keeps the log readable", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = await playTurn(h, "大冒险", "✓ 过");
    const question = h.turn().question!.text;

    await h.press(alice, h.room().messageId, "结束");
    expect(h.tg.labels(h.room().messageId)).toEqual(["确认结束", "取消"]);
    await h.press(alice, h.room().messageId, "取消");
    expect(h.room().status).toBe("playing");
    await h.press(alice, h.room().messageId, "结束");
    await h.press(alice, h.room().messageId, "确认结束");

    const room = h.room();
    expect(room.status).toBe("ended");
    expect(h.tg.pinned.size).toBe(0);
    expect(h.roomMessage().text).toContain("已结束 · 房主结束");
    expect(h.roomMessage().keyboard).toEqual([]);

    const summary = h.tg.last().text;
    expect(summary).toContain("房间 #1 结束");
    expect(summary).toContain(`1. ${performer.firstName}　+2 分`);
    expect(summary).toContain("最勇");

    await h.command(bob, "/log");
    const log = h.tg.last().text;
    expect(log).toContain("房间 #1");
    expect(log).toContain(question.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  });

  it("settles a pending penalty when the game ends mid-turn", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.press(performer, card, "怂了");
    await h.command(alice, "/end");
    expect(records(h)[0]).toMatchObject({ outcome: "chicken", penaltyOutcome: "skipped", points: -2 });
  });

  it("drops an undecided round instead of scoring it", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const performer = performerOf(h);
    const card = h.turnCard().id;
    await h.press(performer, card, "真心话");
    await h.command(alice, "/end");
    expect(records(h)).toHaveLength(0);
    expect(h.tg.message(card).text).toContain("这一轮不算");
    expect(h.tg.message(card).keyboard).toEqual([]);
  });
});

describe("stats across games", () => {
  it("adds up points, games and wins per person", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    const firstWinner = await playTurn(h, "大冒险", "✓ 过");
    await h.command(alice, "/end");

    await roomWith(h, [bob, carol]);
    await playTurn(h, "真心话", "✓ 过");
    await h.command(alice, "/end");

    await h.command(alice, "/stats");
    const stats = h.tg.last().text;
    expect(stats).toContain("2 局 2 轮");
    expect(stats).toMatch(/^1\. \S+　(?:[+−]\d+|0) 分 · 2 局/m);

    await h.command(alice, "/stats", { replyTo: firstWinner });
    const personal = h.tg.last().text;
    expect(personal).toContain(`${firstWinner.firstName} 的真心话大冒险战绩`);
    expect(personal).toContain("大冒险 1");
  });

  it("says so when nothing has been played", async () => {
    const h = createHarness();
    await h.command(alice, "/stats");
    expect(h.tg.last().text).toBe("还没有玩过的记录。");
    await h.command(alice, "/log");
    expect(h.tg.last().text).toBe("还没有记录。");
  });
});

describe("settings", () => {
  it("are host-only", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    expect((await h.press(bob, h.room().messageId, "设置"))?.text).toBe("只有房主能这么做");
  });

  it("change heat, swaps, dare types and vote time", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    const id = h.room().messageId;
    await h.press(alice, id, "设置");
    expect(h.tg.labels(id)).toContain("✓ 微辣 ●●○");
    expect(h.roomMessage().text).toContain("房主正在改设置");
    await h.press(alice, id, "重口");
    await h.press(alice, id, "换题 0");
    await h.press(alice, id, "语音");
    await h.press(alice, id, "投票 90 秒");
    expect(h.room().settings).toMatchObject({ level: 3, rerolls: 0, dareTypes: ["post", "contact"], voteSeconds: 90 });
    expect(h.roomMessage().text).toContain("重口 ●●●");
    await h.press(alice, id, "完成");
    expect(h.tg.labels(id)).toContain("开始");
  });

  it("don't lock others out while the host has the panel open", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.press(alice, h.room().messageId, "设置");
    await h.press(dave, h.room().messageId, "申请加入");
    expect(h.tg.findWithButton("同意")).toBeDefined();
    expect(h.room().view).toBe("settings"); // the host's panel stays open
  });

  it("won't switch to AI questions without an API key", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    const id = h.room().messageId;
    await h.press(alice, id, "设置");
    const answer = await h.press(alice, id, "AI");
    expect(answer).toMatchObject({ text: "没有配置 AI key，只能用题库", alert: true });
    expect(h.room().settings.source).toBe("deck");
  });

  it("keeps at least one dare type", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    const id = h.room().messageId;
    await h.press(alice, id, "设置");
    await h.press(alice, id, "语音");
    await h.press(alice, id, "群里发");
    const answer = await h.press(alice, id, "联系群外");
    expect(answer?.text).toBe("至少要留一种大冒险类型");
    expect(h.room().settings.dareTypes).toEqual(["contact"]);
  });

  it("only draws dares of the enabled types", async () => {
    const h = createHarness({ seed: 11 });
    await roomWith(h, [bob, carol], false);
    const id = h.room().messageId;
    await h.press(alice, id, "设置");
    await h.press(alice, id, "语音");
    await h.press(alice, id, "群里发");
    await h.press(alice, id, "完成");
    await h.press(alice, id, "开始");
    for (let round = 0; round < 6; round++) {
      await playTurn(h, "大冒险", "✓ 过");
      expect(h.turn().question?.type).toBe("contact");
      await h.press(alice, h.turnCard().id, "下一轮");
    }
  });
});

describe("language", () => {
  it("switches the whole chat to English", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.command(alice, "/lang en");
    expect(h.tg.find("Switched to English")).toBeDefined();
    expect(h.roomMessage().text).toContain("Truth or Dare");
    expect(h.roomMessage().text).toContain("Room #1");
    expect(h.tg.labels(h.room().messageId)).toContain("Start");

    await h.command(alice, "/invite @bob");
    await h.press(bob, h.tg.findWithButton("Accept")!.id, "Accept");
    await h.press(alice, h.room().messageId, "Start");
    expect(h.turnCard().text).toContain("Round 1");
    expect(h.tg.labels(h.turnCard().id)).toEqual(["Truth", "Dare"]);

    const performer = performerOf(h);
    await h.press(performer, h.turnCard().id, "Truth");
    expect(h.turn().question!.text).toMatch(/^[\x20-\x7E’—]+$/); // English card text
  });

  it("can be switched from the settings panel", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.press(alice, h.room().messageId, "设置");
    await h.press(alice, h.room().messageId, "English");
    expect(h.roomMessage().text).toContain("Truth or Dare");
    expect(h.tg.labels(h.room().messageId)).toContain("✓ English");
  });
});

describe("AI questions", () => {
  it("uses the AI's question when the room asks for AI", async () => {
    const { llm, calls } = fakeLlm(["说一个你从来没告诉过任何人的小秘密。"]);
    const h = createHarness({ llm });
    await roomWith(h, [bob, carol], false);
    expect(h.room().settings.source).toBe("mix"); // AI configured -> mixed by default
    await h.press(alice, h.room().messageId, "设置");
    await h.press(alice, h.room().messageId, "AI");
    await h.press(alice, h.room().messageId, "完成");
    await h.press(alice, h.room().messageId, "开始");

    const performer = performerOf(h);
    await h.press(performer, h.turnCard().id, "真心话");
    expect(h.turn().question).toMatchObject({ from: "ai", provider: "fake", text: "说一个你从来没告诉过任何人的小秘密。" });
    expect(h.turnCard().text).toContain("AI");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages[1]!.content).toContain("Simplified Chinese");
    expect(calls[0]!.messages[1]!.content).not.toContain(performer.firstName); // no personal data sent
  });

  it("falls back to the deck when the AI is down", async () => {
    const { llm } = fakeLlm([], { fail: true });
    const h = createHarness({ llm });
    await roomWith(h, [bob, carol], false);
    await h.press(alice, h.room().messageId, "设置");
    await h.press(alice, h.room().messageId, "AI");
    await h.press(alice, h.room().messageId, "完成");
    await h.press(alice, h.room().messageId, "开始");
    const performer = performerOf(h);
    await h.press(performer, h.turnCard().id, "大冒险");
    expect(h.turn().question?.from).toBe("deck");
    expect(h.turn().phase).toBe("performing");
  });

  it("tells the AI which questions were already used", async () => {
    const { llm, calls } = fakeLlm(["第一题：你最怕什么？", "第二题：你最想去哪？"]);
    const h = createHarness({ llm });
    await roomWith(h, [bob, carol], false);
    await h.press(alice, h.room().messageId, "设置");
    await h.press(alice, h.room().messageId, "AI");
    await h.press(alice, h.room().messageId, "完成");
    await h.press(alice, h.room().messageId, "开始");
    const performer = performerOf(h);
    await h.press(performer, h.turnCard().id, "真心话");
    await h.press(performer, h.turnCard().id, "换一题");
    expect(calls[1]!.messages[1]!.content).toContain("第一题：你最怕什么？");
  });
});
