import type { GameContext } from "../../core/game";
import type { Lang } from "../../core/i18n";
import { gameLog, roomLog } from "../../core/turn-log";
import type { Sql } from "../../platform/sql";
import { esc } from "../../telegram/html";
import { button, type Keyboard } from "../../telegram/port";
import { G, heat, signed } from "../../ui/glyphs";
import { todMessages, type TodMessages } from "./i18n";
import {
  POINTS,
  TURN_LOG_KIND,
  type Ballot,
  type MainOutcome,
  type PenaltyOutcome,
  type TodSettings,
  type TodState,
  type Turn,
  type TurnRecord,
} from "./types";

export type TodContext = GameContext<TodSettings, TodState>;

const msgs = (game: TodContext): TodMessages => todMessages[game.lang];

const rankLabel = (index: number) => `${index + 1}.`;

export function mainPassPoints(turn: { kind: Turn["kind"] }): number {
  return turn.kind === "dare" ? POINTS.darePass : POINTS.truthPass;
}

function ballotCounts(ballot: Ballot | null): [number, number] {
  return [ballot?.yes.length ?? 0, ballot?.no.length ?? 0];
}

// ----------------------------------------------------------------- turn card

export function renderTurnCard(
  game: TodContext,
  turn: Turn,
  options: { showNext?: boolean; generating?: boolean; abandoned?: boolean } = {},
): { text: string; keyboard: Keyboard } {
  const t = msgs(game);
  const lines: string[] = [];

  if (!turn.kind) {
    lines.push(t.turnTitle(turn.no), t.spunTo(game.mention(turn.playerId)));
    if (turn.phase === "choosing" && !options.abandoned) lines.push(t.chooseQuestion);
  } else {
    lines.push(`${t.turnTitle(turn.no)} ${G.dot} ${game.mention(turn.playerId)} ${G.dot} ${t.kinds[turn.kind]}`);
    if (turn.question) {
      const level = turn.question.level;
      const meta = [`${t.levels[level]} ${heat(level)}`, t.questionFrom[turn.question.from]];
      if (turn.rerolled.length) meta.push(t.rerolledNote(turn.rerolled.length));
      lines.push(meta.join(` ${G.dot} `), "", `<blockquote>${esc(turn.question.text)}</blockquote>`);
    }
  }

  if (options.generating) {
    lines.push("", t.generating);
    return { text: lines.join("\n"), keyboard: [] };
  }

  const waitingLines = () => {
    const vote = turn.vote;
    if (!vote) return [];
    const voted = new Set([...vote.yes, ...vote.no]);
    const waiting = vote.eligible.filter((id) => !voted.has(id)).map((id) => game.name(id));
    return [t.votingTitle(game.room.settings.voteSeconds), ...(waiting.length ? [t.waitingFor(waiting.join(game.core.sep))] : [])];
  };

  if (turn.phase === "performing") lines.push("", t.performHint);
  if (turn.phase === "voting") lines.push("", ...waitingLines());

  if (turn.outcome && turn.outcome !== "skipped") lines.push("", mainOutcomeLine(t, turn));
  if (turn.penalty) {
    lines.push("", t.penaltyTitle, `<blockquote>${esc(turn.penalty.text)}</blockquote>`);
    if (turn.phase === "penalty") lines.push(t.penaltyHint);
    if (turn.phase === "penalty-voting") lines.push(...waitingLines());
    if (turn.penaltyOutcome) lines.push(penaltyOutcomeLine(t, turn.penaltyOutcome, turn.penaltyVote));
  }
  if (turn.skipReason) {
    lines.push("", turn.skipReason === "host" ? t.skippedByHost : t.skippedLeft(game.name(turn.playerId)));
  }
  if (options.abandoned) lines.push("", t.abandoned);
  if (turn.phase === "done" && turn.penalty) lines.push(t.turnTotal(t.points(turn.points)));

  return { text: lines.join("\n"), keyboard: options.abandoned ? [] : turnKeyboard(game, turn, options.showNext ?? false) };
}

function mainOutcomeLine(t: TodMessages, turn: Turn): string {
  const [yes, no] = ballotCounts(turn.mainVote);
  switch (turn.outcome) {
    case "pass":
      return t.passLine(yes, no, t.points(mainPassPoints(turn)));
    case "fail":
      return t.failLine(yes, no, t.points(POINTS.fail));
    case "chicken":
      return t.chickenLine(t.points(POINTS.chicken));
    default:
      return "";
  }
}

function penaltyOutcomeLine(t: TodMessages, outcome: PenaltyOutcome, ballot: Ballot | null): string {
  const [yes, no] = ballotCounts(ballot);
  if (outcome === "pass") return t.penaltyPassLine(yes, no, t.points(POINTS.penaltyPass));
  if (outcome === "fail") return t.penaltyFailLine(yes, no, t.points(POINTS.penaltyFail));
  return t.penaltySkippedLine;
}

/** Colour language: green = go / pass, red = dare / chicken / fail, blue = the main next step. */
function turnKeyboard(game: TodContext, turn: Turn, showNext: boolean): Keyboard {
  const t = msgs(game);
  const no = turn.no;
  switch (turn.phase) {
    case "choosing":
      return [
        [
          button(t.btnTruth, game.callback("c", no, "t"), "primary"),
          button(t.btnDare, game.callback("c", no, "d"), "danger"),
        ],
      ];
    case "performing": {
      const used = game.room.state?.rerollsUsed[turn.playerId] ?? 0;
      const left = game.room.settings.rerolls - used;
      const second = [button(t.btnChicken, game.callback("ch", no), "danger")];
      if (left > 0) second.unshift(button(t.btnReroll(left), game.callback("rr", no)));
      return [[button(t.btnDone, game.callback("dn", no), "success")], second];
    }
    case "penalty":
      return [[button(t.btnDone, game.callback("dn", no), "success")]];
    case "voting":
    case "penalty-voting": {
      const [yes, noCount] = ballotCounts(turn.vote);
      return [
        [
          button(t.btnYes(yes), game.callback("v", no, "y"), "success"),
          button(t.btnNo(noCount), game.callback("v", no, "n"), "danger"),
        ],
      ];
    }
    case "done":
      return showNext ? [[button(t.btnNext, game.callback("nx", no), "primary")]] : [];
  }
}

// --------------------------------------------------------------- live board

export function turnRecords(sql: Sql, roomId: number): TurnRecord[] {
  return roomLog<TurnRecord>(sql, roomId, TURN_LOG_KIND).map((entry) => entry.data);
}

/** One line per finished round, e.g. "#6 Carol 真心话 怂 → 罚 ✓ −1". */
function compactTurnLine(game: TodContext, record: TurnRecord): string {
  const t = msgs(game);
  const mark = (outcome: MainOutcome | PenaltyOutcome): string =>
    outcome === "pass" ? G.check : outcome === "fail" ? G.cross : outcome === "chicken" ? t.compactChicken : t.compactSkipped;
  const parts = [`#${record.no}`, game.name(record.playerId)];
  if (record.kind) parts.push(t.kinds[record.kind]);
  parts.push(mark(record.outcome));
  if (record.penaltyOutcome) parts.push(G.arrow, `${t.compactPenalty} ${mark(record.penaltyOutcome)}`);
  parts.push(signed(record.points));
  return parts.join(" ");
}

export function renderBoard(game: TodContext): string {
  const t = msgs(game);
  const state = game.room.state;
  const current = new Set(game.players());
  const everyone = game.everyPlayer();
  const scores = state?.scores ?? {};
  const ranked = everyone
    .filter((id) => current.has(id) || (scores[id] ?? 0) !== 0)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

  const lines = [t.boardScores];
  ranked.forEach((id, index) => {
    const left = current.has(id) ? "" : ` ${t.boardLeft}`;
    lines.push(`${rankLabel(index)} ${game.name(id)}　${signed(scores[id] ?? 0)}${left}`);
  });

  const records = turnRecords(game.sql, game.room.id);
  lines.push("", t.boardRecent);
  if (records.length === 0) lines.push(t.boardNoTurns);
  for (const record of records.slice(-6).reverse()) lines.push(compactTurnLine(game, record));
  lines.push("", t.boardFooter);
  return lines.join("\n");
}

// --------------------------------------------------------------------- /log

export function renderLog(game: TodContext, emptyText: string): string {
  const t = msgs(game);
  const records = turnRecords(game.sql, game.room.id);
  if (records.length === 0) return emptyText;
  const lines = [t.logTitle(game.room.id, records.length), ""];
  for (const record of records) {
    const head = [`<b>#${record.no}</b> ${game.name(record.playerId)}`];
    if (record.kind) head.push(t.kinds[record.kind]);
    if (record.question) head.push(`${t.levels[record.question.level]} ${heat(record.question.level)}`, t.questionFrom[record.question.from]);
    lines.push(head.join(` ${G.dot} `));
    if (record.question) lines.push(`<i>${esc(record.question.text)}</i>`);
    if (record.rerolled.length) lines.push(t.logRerolled(record.rerolled.length));
    const [yes, no] = ballotCounts(record.mainVote);
    lines.push(`${t.outcome[record.outcome]}${record.mainVote ? t.logVotes(yes, no) : ""}`);
    if (record.penalty) {
      const [penaltyYes, penaltyNo] = ballotCounts(record.penaltyVote);
      const verdict = record.penaltyOutcome ? t.penaltyOutcome[record.penaltyOutcome] : "";
      const votes = record.penaltyVote ? t.logVotes(penaltyYes, penaltyNo) : "";
      lines.push(`${t.logPenalty}<i>${esc(record.penalty.text)}</i> ${verdict}${votes}`);
    }
    lines.push(t.logTurnTotal(t.points(record.points), t.duration(record.endedAt - record.startedAt)), "");
  }
  return lines.join("\n").trim();
}

// -------------------------------------------------------------- end summary

interface PlayerTally {
  userId: number;
  points: number;
  turns: number;
  truths: number;
  dares: number;
  passes: number;
  fails: number;
  chickens: number;
  penalties: number;
  penaltyPasses: number;
  rerolls: number;
  time: number;
}

function emptyTally(userId: number): PlayerTally {
  return { userId, points: 0, turns: 0, truths: 0, dares: 0, passes: 0, fails: 0, chickens: 0, penalties: 0, penaltyPasses: 0, rerolls: 0, time: 0 };
}

function tallyRecords(records: TurnRecord[], seed: number[] = []): Map<number, PlayerTally> {
  const tallies = new Map<number, PlayerTally>(seed.map((id) => [id, emptyTally(id)]));
  for (const record of records) {
    const tally = tallies.get(record.playerId) ?? emptyTally(record.playerId);
    tallies.set(record.playerId, tally);
    tally.points += record.points;
    if (record.outcome === "skipped" && !record.kind) continue; // skipped before choosing: not really a turn
    tally.turns += 1;
    if (record.kind === "truth") tally.truths += 1;
    if (record.kind === "dare") tally.dares += 1;
    if (record.outcome === "pass") tally.passes += 1;
    if (record.outcome === "fail") tally.fails += 1;
    if (record.outcome === "chicken") tally.chickens += 1;
    if (record.penalty) tally.penalties += 1;
    if (record.penaltyOutcome === "pass") tally.penaltyPasses += 1;
    tally.rerolls += record.rerolled.length;
    tally.time += record.endedAt - record.startedAt;
  }
  return tallies;
}

function byScore(a: PlayerTally, b: PlayerTally): number {
  return b.points - a.points || b.passes - a.passes || a.chickens - b.chickens;
}

export function renderSummary(game: TodContext, records: TurnRecord[]): string | null {
  if (records.length === 0) return null;
  const t = msgs(game);
  const tallies = [...tallyRecords(records, game.everyPlayer()).values()].sort(byScore);
  const started = game.room.startedAt ?? records[0]!.startedAt;
  const ended = game.room.endedAt ?? game.now();

  const lines = [t.summaryTitle(game.room.id), t.summaryMeta(records.length, t.duration(ended - started)), "", t.rankingTitle];
  tallies.forEach((tally, index) => {
    const name = game.name(tally.userId);
    const line =
      tally.turns === 0
        ? t.rankingNeverPicked(name, tally.points)
        : t.rankingLine(name, tally.points, tally.truths, tally.dares, tally.passes, tally.turns, tally.chickens);
    lines.push(`${rankLabel(index)} ${line}`);
  });

  const top = (pick: (tally: PlayerTally) => number) =>
    [...tallies].sort((a, b) => pick(b) - pick(a)).find((tally) => pick(tally) > 0);
  const highlights: string[] = [];
  const bravest = top((tally) => tally.dares);
  if (bravest) highlights.push(t.bravest(game.name(bravest.userId), bravest.dares));
  const chicken = top((tally) => tally.chickens);
  if (chicken) highlights.push(t.mostChicken(game.name(chicken.userId), chicken.chickens));
  const penaltyKing = top((tally) => tally.penalties);
  if (penaltyKing) highlights.push(t.penaltyKing(game.name(penaltyKing.userId), penaltyKing.penalties));
  // "Longest round" only means something once there are a few rounds to compare.
  const played = records.filter((record) => record.kind);
  const longest = played.length >= 3 ? [...played].sort((a, b) => b.endedAt - b.startedAt - (a.endedAt - a.startedAt))[0] : undefined;
  if (longest) highlights.push(t.longest(longest.no, game.name(longest.playerId), t.duration(longest.endedAt - longest.startedAt)));
  if (highlights.length) lines.push("", t.highlightsTitle, ...highlights);
  return lines.join("\n");
}

// ------------------------------------------------------------------- /stats

export function renderStats(
  sql: Sql,
  lang: Lang,
  names: (userId: number) => string,
  focusUserId: number | null,
): string | null {
  const t = todMessages[lang];
  const entries = gameLog<TurnRecord>(sql, "tod", TURN_LOG_KIND);
  const memberships = sql.all<{ room_id: number; status: string; user_id: number }>(
    `SELECT r.id AS room_id, r.status AS status, rp.user_id AS user_id
       FROM rooms r JOIN room_players rp ON rp.room_id = r.id
      WHERE r.game = 'tod' AND r.started_at IS NOT NULL`,
  );
  if (entries.length === 0 && memberships.length === 0) return null;

  const tallies = tallyRecords(entries.map((entry) => entry.data));
  const gamesPlayed = new Map<number, Set<number>>();
  for (const row of memberships) {
    if (!tallies.has(row.user_id)) tallies.set(row.user_id, emptyTally(row.user_id));
    const rooms = gamesPlayed.get(row.user_id) ?? new Set<number>();
    rooms.add(row.room_id);
    gamesPlayed.set(row.user_id, rooms);
  }

  // A win = top score (above zero) in a finished room; ties share the win.
  const endedRooms = new Set(memberships.filter((row) => row.status === "ended").map((row) => row.room_id));
  const roomScores = new Map<number, Map<number, number>>();
  for (const entry of entries) {
    if (!endedRooms.has(entry.roomId)) continue;
    const scores = roomScores.get(entry.roomId) ?? new Map<number, number>();
    scores.set(entry.data.playerId, (scores.get(entry.data.playerId) ?? 0) + entry.data.points);
    roomScores.set(entry.roomId, scores);
  }
  const wins = new Map<number, number>();
  for (const scores of roomScores.values()) {
    const best = Math.max(...scores.values());
    if (best <= 0) continue;
    for (const [userId, score] of scores) if (score === best) wins.set(userId, (wins.get(userId) ?? 0) + 1);
  }

  const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
  const gameCount = new Set(memberships.map((row) => row.room_id)).size;

  if (focusUserId !== null) {
    const tally = tallies.get(focusUserId);
    const name = esc(names(focusUserId));
    if (!tally || tally.turns === 0) return t.personalNone(name);
    return [
      t.personalTitle(name),
      t.personalTotals(tally.points, gamesPlayed.get(focusUserId)?.size ?? 0, wins.get(focusUserId) ?? 0),
      t.personalTurns(tally.turns, tally.truths, tally.dares),
      t.personalResults(tally.passes, tally.fails, tally.chickens, tally.penalties, tally.penaltyPasses),
      t.personalMisc(tally.rerolls, t.duration(tally.time / tally.turns)),
    ].join("\n");
  }

  const ranked = [...tallies.values()].sort(byScore);
  const lines = [t.statsTitle(gameCount, entries.length)];
  ranked.forEach((tally, index) => {
    if (tally.turns === 0) {
      lines.push(`${rankLabel(index)} ${t.statsLineNeverPicked(esc(names(tally.userId)), gamesPlayed.get(tally.userId)?.size ?? 0)}`);
      return;
    }
    lines.push(
      `${rankLabel(index)} ${t.statsLine(
        esc(names(tally.userId)),
        tally.points,
        gamesPlayed.get(tally.userId)?.size ?? 0,
        wins.get(tally.userId) ?? 0,
        tally.turns,
        percent(tally.dares, tally.truths + tally.dares),
        percent(tally.passes, tally.turns),
        tally.chickens,
      )}`,
    );
  });
  return lines.join("\n");
}
