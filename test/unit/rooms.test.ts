import type { Update } from "grammy/types";
import { describe, expect, it } from "vitest";
import { LOBBY_IDLE_MS, PLAYING_IDLE_MS } from "../../src/core/app";
import { getMember } from "../../src/core/members";
import { alice, bob, carol, createHarness, dave, erin, GROUP_ID, inviteCommand, roomWith } from "../helpers/harness";

describe("opening a room", () => {
  it("creates a lobby with the opener as host and only player", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const room = h.room();
    expect(room.status).toBe("lobby");
    expect(room.hostId).toBe(alice.id);
    expect(h.players()).toEqual([alice.id]);
    const message = h.roomMessage();
    expect(message.text).toContain("真心话大冒险");
    expect(message.text).toContain("房间 #1");
    expect(message.text).toContain("♛ 房主 Alice");
    expect(h.tg.labels(room.messageId)).toEqual(["申请加入", "退出", "邀请", "设置", "开始", "解散"]);
    expect(h.alarm).toBe(h.now() + LOBBY_IDLE_MS);
  });

  it("points at the open room instead of opening a second one", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const first = h.room().messageId;
    await h.command(bob, "/play");
    expect(h.tg.last().text).toContain("已经有一个房间了");
    expect(h.tg.last().replyTo).toBe(first);
    expect(h.sql.all("SELECT id FROM rooms")).toHaveLength(1);
  });

  it("keeps the room inside the forum topic it was opened in", async () => {
    const h = createHarness();
    await h.command(alice, "/play", { threadId: 77 });
    expect(h.roomMessage().threadId).toBe(77);
    await h.command(alice, "/invite @bob", { threadId: 77 });
    expect(h.tg.findWithButton("接受")!.threadId).toBe(77);
  });

  it("escapes names so a hostile display name can't break the message", async () => {
    const h = createHarness();
    await h.command(erin, "/play");
    expect(h.roomMessage().text).toContain("Erin &lt;&amp;&gt;");
  });
});

describe("invitations", () => {
  it("lets an @username invitee the bot has never seen accept", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.command(alice, "/invite @bob");
    const invite = h.tg.findWithButton("接受")!;
    expect(invite.text).toContain("@bob");
    expect(h.roomMessage().text).toContain("等待接受：@bob");

    await h.press(bob, invite.id, "接受");
    expect(h.players()).toEqual([alice.id, bob.id]);
    expect(h.tg.message(invite.id).text).toContain("✓ 来了");
    expect(h.tg.message(invite.id).keyboard).toEqual([]);
    expect(h.roomMessage().text).not.toContain("等待接受");
  });

  it("refuses an invitation meant for someone else", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.command(alice, "/invite @bob");
    const invite = h.tg.findWithButton("接受")!;
    const answer = await h.press(carol, invite.id, "接受");
    expect(answer?.text).toContain("这条邀请不是给你的");
    expect(answer?.alert).toBe(true);
    expect(h.players()).toEqual([alice.id]);
  });

  it("invites people without a username through text mentions and replies", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const { text, textMentions } = inviteCommand([carol]);
    await h.command(alice, text, { textMentions });
    const first = h.tg.findWithButton("接受")!;
    expect(first.text).toContain("tg://user?id=103");
    await h.press(carol, first.id, "接受");

    await h.command(alice, "/invite", { replyTo: dave });
    const second = h.tg.findWithButton("接受")!;
    await h.press(dave, second.id, "接受");
    expect(h.players()).toEqual([alice.id, carol.id, dave.id]);
  });

  it("only lets the host invite, and explains the syntax", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    await h.command(bob, "/invite @dave");
    expect(h.tg.last().text).toBe("只有房主能这么做");
    await h.command(alice, "/invite");
    expect(h.tg.last().text).toContain("/invite @用户名");
  });

  it("records a decline", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.command(alice, "/invite @bob @dave");
    const invite = h.tg.findWithButton("接受")!;
    await h.press(bob, invite.id, "不去了");
    expect(h.players()).toEqual([alice.id]);
    expect(h.tg.message(invite.id).text).toContain("✗ 不来");
    expect(h.tg.labels(invite.id)).toContain("接受"); // Dave hasn't answered yet
    expect((await h.press(bob, invite.id, "接受"))?.text).toBe("你已经回应过了");
  });

  it("does not invite people who are already in or already invited", async () => {
    const h = createHarness();
    await roomWith(h, [bob], false);
    await h.command(alice, "/invite @dave");
    const before = h.tg.messages.size;
    await h.command(alice, "/invite @bob @dave");
    expect(h.tg.messages.size).toBe(before + 1);
    expect(h.tg.last().text).toContain("已经在房间里");
  });

  it("treats 'ask to join' from an invited person as accepting", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.command(alice, "/invite @bob");
    const answer = await h.press(bob, h.room().messageId, "申请加入");
    expect(answer?.text).toBe("你被邀请过，直接进来了");
    expect(h.players()).toEqual([alice.id, bob.id]);
  });
});

describe("join requests", () => {
  it("need the host's approval", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const answer = await h.press(dave, h.room().messageId, "申请加入");
    expect(answer?.text).toBe("已申请，等房主同意");
    const request = h.tg.findWithButton("同意")!;
    expect(request.text).toContain("想加入房间 #1");
    expect(h.roomMessage().text).toContain("申请中：Dave");

    expect((await h.press(bob, request.id, "同意"))?.text).toBe("只有房主能这么做");
    expect(h.players()).toEqual([alice.id]);

    await h.press(alice, request.id, "同意");
    expect(h.players()).toEqual([alice.id, dave.id]);
    expect(h.tg.message(request.id).text).toContain("✓ Dave 加入了房间 #1");
    expect(h.tg.message(request.id).keyboard).toEqual([]);
  });

  it("can be denied, and are not duplicated", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.press(dave, h.room().messageId, "申请加入");
    expect((await h.press(dave, h.room().messageId, "申请加入"))?.text).toBe("已经申请过了，等房主同意");
    const request = h.tg.findWithButton("拒绝")!;
    const denyData = h.tg.buttonData(request.id, "拒绝");
    await h.press(alice, request.id, "拒绝");
    expect(h.players()).toEqual([alice.id]);
    expect(h.tg.message(request.id).text).toContain("房主没有同意 Dave");
    expect(h.tg.message(request.id).keyboard).toEqual([]);
    // A double tap that slipped through before the buttons disappeared changes nothing.
    expect((await h.pressData(alice, request.id, denyData))?.text).toBe("这个申请已经处理过了");
  });
});

describe("pickers", () => {
  it("invite people the bot has already seen", async () => {
    const h = createHarness();
    await h.command(carol, "/help");
    await h.command(dave, "/help");
    await h.command(alice, "/play");
    await h.press(alice, h.room().messageId, "邀请");
    const picker = h.tg.findWithButton("发送邀请")!;
    expect(h.tg.labels(picker.id)).toEqual(expect.arrayContaining(["Carol", "Dave"]));
    expect(h.tg.labels(picker.id)).not.toContain("Alice");

    expect((await h.press(bob, picker.id, "Carol"))?.text).toBe("只有房主能这么做");
    await h.press(alice, picker.id, "Carol");
    expect(h.tg.labels(picker.id)).toContain("✓ Carol");
    await h.press(alice, picker.id, "发送邀请 · 1");
    expect(h.tg.message(picker.id).keyboard).toEqual([]);

    const invite = h.tg.findWithButton("接受")!;
    expect(invite.text).toContain("tg://user?id=103");
    await h.press(carol, invite.id, "接受");
    expect(h.players()).toContain(carol.id);
  });

  it("explain what to do when nobody can be listed", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const answer = await h.press(alice, h.room().messageId, "邀请");
    expect(answer?.alert).toBe(true);
    expect(answer?.text).toContain("/invite @用户名");
  });

  it("remove players the host picks during a game", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    await h.press(alice, h.room().messageId, "踢人");
    const picker = h.tg.findWithButton("踢出")!;
    expect(h.tg.labels(picker.id)).toEqual(["Bob", "Carol", "踢出 · 0", "关闭"]);
    await h.press(alice, picker.id, "Bob");
    await h.press(alice, picker.id, "踢出 · 1");
    expect(h.players()).toEqual([alice.id, carol.id]);
    expect(h.tg.find("被请出了房间")?.text).toContain("Bob");
  });

  it("/kick works by mention too", async () => {
    const h = createHarness();
    await roomWith(h, [bob, dave], false);
    await h.command(alice, "/kick @dave");
    expect(h.players()).toEqual([alice.id, bob.id]);
    await h.command(alice, "/kick @dave");
    expect(h.tg.last().text).toBe("这个人不在房间里。");
  });
});

describe("leaving and host changes", () => {
  it("hands the host role to the earliest remaining player", async () => {
    const h = createHarness();
    await roomWith(h, [bob, dave], false);
    await h.press(alice, h.room().messageId, "退出");
    expect(h.room().hostId).toBe(bob.id);
    expect(h.tg.find("房主换成了")?.text).toContain("tg://user?id=102");
    expect(h.roomMessage().text).toContain("♛ 房主 Bob");
  });

  it("does not let the last player walk out of an open room", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const answer = await h.press(alice, h.room().messageId, "退出");
    expect(answer?.alert).toBe(true);
    expect(h.players()).toEqual([alice.id]);
  });
});

describe("ending rooms", () => {
  it("asks before disbanding a lobby", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    await h.press(alice, h.room().messageId, "解散");
    expect(h.tg.labels(h.room().messageId)).toEqual(["确认解散", "取消"]);
    await h.press(alice, h.room().messageId, "确认解散");
    expect(h.room().status).toBe("ended");
    expect(h.room().endReason).toBe("disbanded");
    expect(h.roomMessage().text).toContain("这个房间已经解散了");
    expect(h.roomMessage().keyboard).toEqual([]);
    expect(h.alarm).toBeNull();
  });

  it("lets a group admin end a game, but not a random member", async () => {
    const h = createHarness();
    await roomWith(h, [bob, carol]);
    await h.command(dave, "/end");
    expect(h.tg.last().text).toBe("只有房主或群管理员可以");
    h.tg.admins.add(dave.id);
    await h.command(dave, "/end");
    expect(h.room().status).toBe("ended");
    expect(h.room().endReason).toBe("admin");
  });

  it("closes a lobby nobody starts after an hour", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    h.advance(LOBBY_IDLE_MS);
    await h.fireAlarm();
    expect(h.room().status).toBe("ended");
    expect(h.room().endReason).toBe("idle");
  });

  it("keeps a game open while people keep playing", async () => {
    const h = createHarness();
    await roomWith(h, [bob]);
    h.advance(2 * 60 * 60 * 1000);
    await h.press(alice, h.room().messageId, "跳过本轮"); // any activity counts
    h.advance(90 * 60 * 1000);
    await h.fireAlarm();
    expect(h.room().status).toBe("playing");
    expect(h.alarm).toBe(h.room().lastActivityAt + PLAYING_IDLE_MS);
    h.advance(PLAYING_IDLE_MS);
    await h.fireAlarm();
    expect(h.room().status).toBe("ended");
    expect(h.room().endReason).toBe("idle");
  });
});

describe("chat-level behaviour", () => {
  it("ignores redelivered updates", async () => {
    const h = createHarness();
    const update = h.messageUpdate(alice, "/play");
    await h.send(update);
    await h.send(update);
    expect(h.sql.all("SELECT id FROM rooms")).toHaveLength(1);
    expect(h.tg.messages.size).toBe(1);
  });

  it("refuses groups outside the allowlist and leaves them", async () => {
    const h = createHarness({ allowedChatIds: [-42] });
    await h.command(alice, "/play");
    expect(h.tg.last().text).toContain(String(GROUP_ID));
    expect(h.tg.leftChat).toBe(true);
    expect(h.sql.all("SELECT id FROM rooms")).toHaveLength(0);
  });

  it("ignores commands addressed to another bot", async () => {
    const h = createHarness();
    await h.command(alice, "/play@OtherBot");
    expect(h.sql.all("SELECT id FROM rooms")).toHaveLength(0);
    await h.command(alice, "/play@TestGameBot");
    expect(h.sql.all("SELECT id FROM rooms")).toHaveLength(1);
    await h.command(bob, "/help@TestGameBot");
    expect(h.tg.getMeCalls).toBe(1); // cached after the first lookup
  });

  it("re-posts the room message if someone deleted it", async () => {
    const h = createHarness();
    await h.command(alice, "/play");
    const original = h.room().messageId!;
    h.tg.deleted.add(original);
    await h.command(alice, "/invite @bob");
    expect(h.room().messageId).not.toBe(original);
    expect(h.roomMessage().text).toContain("@bob");
  });

  it("introduces itself when added to a group", async () => {
    const h = createHarness();
    await h.send({
      update_id: 900,
      my_chat_member: {
        chat: { id: GROUP_ID, type: "supergroup", title: "Friends" },
        from: { id: alice.id, is_bot: false, first_name: "Alice" },
        date: 0,
        old_chat_member: { status: "left", user: { id: 1, is_bot: true, first_name: "Bot" } },
        new_chat_member: { status: "member", user: { id: 1, is_bot: true, first_name: "Bot" } },
      },
    } as Update);
    expect(h.tg.last().text).toContain("/play");
  });

  it("explains itself in a private chat", async () => {
    const h = createHarness({ chatId: alice.id });
    await h.command(alice, "/start", { chat: "private" });
    expect(h.tg.last().text).toContain("把我拉进你们的群");
  });

  it("remembers who opened a DM through the group's deep link", async () => {
    const h = createHarness();
    await h.command(bob, `/start g${GROUP_ID}`, { chat: "private" });
    expect(getMember(h.sql, bob.id)?.dmOk).toBe(true);
    expect(h.tg.direct.at(-1)).toMatchObject({ userId: bob.id });
  });

  it("closes the room and hands history over when the group becomes a supergroup", async () => {
    const h = createHarness();
    await roomWith(h, [bob]);
    await h.send({
      update_id: 901,
      message: {
        message_id: 999,
        date: 0,
        chat: { id: GROUP_ID, type: "group", title: "Friends" },
        from: { id: alice.id, is_bot: false, first_name: "Alice" },
        migrate_to_chat_id: -1009999,
      },
    } as Update);
    expect(h.room().status).toBe("ended");
    expect(h.room().endReason).toBe("migrated");
    expect(h.migrations).toEqual([{ to: -1009999 }]);
  });
});
