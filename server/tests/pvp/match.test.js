import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { prepareTestEnv } from "../helpers.js";
import { makeBars } from "../../../shared/fixtures/golden.js";
import { NOW, balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { acceptChallenge, createChallenge, markReady } = await import("../../src/lib/pvp/challenges.js");
const {
  clearHeartbeats,
  forfeitMatch,
  lockAction,
  noteHeartbeat,
  readMatchView,
  resolveIfDue,
  scanDueMatches,
  setCommitBarrier,
} = await import("../../src/lib/pvp/match.js");
const { recoverOnBoot } = await import("../../src/lib/pvp/recovery.js");

config.pvpBattleEnabled = true;
migrate();
const db = openDb();
let keyN = 0;

const BARS = makeBars({
  1: { close: 10 },
  2: { open: 20, close: 22, high: 22, low: 20 },
});
for (const bar of BARS) bar.volume = 10;

test.after(() => closeDb());

function key(label) {
  keyN += 1;
  return `match-${label}-${keyN}-0123456789abcdef`;
}

function user(label) {
  return seedUser(db, { name: `${label}-${crypto.randomUUID()}` });
}

function startMatch(label) {
  const a = user(`${label}-a`);
  const b = user(`${label}-b`);
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key(label), now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created));
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(markReady(db, { matchId: accepted.matchId, userId: a, now: NOW + 1 }).waiting, true);
  const started = markReady(db, { matchId: accepted.matchId, userId: b, now: NOW + 2 });
  assert.equal(started.started, true, JSON.stringify(started));
  return { a, b, matchId: accepted.matchId };
}

function arm(matchId, { rounds = 0, opensAt = NOW, deadlineAt = NOW + 30_000 } = {}) {
  const history = BARS.map((bar, index) => ({ ...bar, date: `H${index + 1}` }));
  const snapshot = {
    stockCode: "600519",
    stockName: "贵州茅台",
    stockIndex: 7,
    windowStart: "2019-03-01",
    history,
    bars: BARS,
  };
  db.prepare(
    `UPDATE pvp_matches
     SET snapshot_json = ?, snapshot_sha256 = ?, resolved_rounds = ?, round_opens_at = ?, round_deadline_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(snapshot), "fixture", rounds, opensAt, deadlineAt, matchId);
  db.prepare(`UPDATE pvp_match_players SET actions_json = ? WHERE match_id = ?`).run(
    JSON.stringify(Array.from({ length: rounds }, () => "hold")),
    matchId
  );
}

function settlementOf(matchId) {
  return db.prepare(`SELECT * FROM pvp_settlements WHERE match_id = ?`).get(matchId);
}

function memberCount(matchId) {
  return db.prepare(`SELECT COUNT(*) AS c FROM pvp_active_members WHERE match_id = ?`).get(matchId).c;
}

test("R08 a new action closes at the deadline, and the same key still replays", () => {
  const { a, b, matchId } = startMatch("r08");
  const deadline = NOW + 30_000;
  arm(matchId, { opensAt: NOW, deadlineAt: deadline });
  const command = key("buy");

  const tooEarly = lockAction(db, {
    matchId, userId: a, round: 1, action: "buy", commandKey: key("soon"), now: NOW - 1,
  });
  assert.equal(tooEarly.code, "ROUND_CLOSED");

  const locked = lockAction(db, {
    matchId, userId: a, round: 1, action: "buy", commandKey: command, now: deadline - 1,
  });
  assert.equal(locked.accepted, true);
  assert.equal(locked.lockedAction, "buy");
  assert.equal(locked.round, 1);
  assert.equal(JSON.stringify(locked).includes("600519"), false);
  assert.deepEqual(Object.keys(locked).sort(), ["accepted", "lockedAction", "ok", "revision", "round"]);

  const mine = readMatchView(db, { matchId, viewerId: a, now: deadline - 1 });
  const theirs = readMatchView(db, { matchId, viewerId: b, now: deadline - 1 });
  assert.equal(mine.me.mtmPpm, 0);
  assert.equal(mine.me.lockedAction, "buy");
  assert.equal(mine.resolvedRounds, 0);
  assert.equal(theirs.opponent.lockedToday, true);
  assert.equal(JSON.stringify(theirs.opponent).includes("buy"), false);
  assert.equal(JSON.stringify(mine).includes("600519"), false);
  assert.equal(JSON.stringify(mine).includes("贵州茅台"), false);
  assert.equal(JSON.stringify(mine).includes("2019-03"), false);
  assert.equal(mine.opponent.userId, undefined);

  assert.equal(lockAction(db, {
    matchId, userId: b, round: 1, action: "hold", commandKey: key("eq"), now: deadline,
  }).code, "ROUND_CLOSED");
  assert.equal(lockAction(db, {
    matchId, userId: b, round: 1, action: "hold", commandKey: key("late"), now: deadline + 1,
  }).code, "ROUND_CLOSED");

  const replay = lockAction(db, {
    matchId, userId: a, round: 1, action: "buy", commandKey: command, now: deadline + 50_000,
  });
  assert.deepEqual(replay, locked);
  assert.equal(lockAction(db, {
    matchId, userId: a, round: 1, action: "hold", commandKey: command, now: deadline - 1,
  }).code, "IDEMPOTENCY_CONFLICT");
  assert.equal(lockAction(db, {
    matchId, userId: a, round: 1, action: "buy", commandKey: key("other"), now: deadline - 1,
  }).code, "ALREADY_LOCKED");
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_actions WHERE match_id = ?`).get(matchId).c, 1);

  const sell = lockAction(db, {
    matchId, userId: b, round: 1, action: "sell", commandKey: key("sell"), now: NOW,
  });
  assert.equal(sell.code, "ILLEGAL_ACTION");
  assert.equal(JSON.stringify(sell).includes("price"), false);
  assert.equal(JSON.stringify(sell).includes("600519"), false);
});

test("locking buy does not move NAV, and resolving it shows the curve tail", () => {
  const { a, b, matchId } = startMatch("nav");
  arm(matchId);
  const buy = lockAction(db, {
    matchId, userId: a, round: 1, action: "buy", commandKey: key("buy"), now: NOW + 10,
  });
  assert.equal(buy.accepted, true);
  assert.equal(readMatchView(db, { matchId, viewerId: a, now: NOW + 10 }).me.mtmPpm, 0);

  const hold = lockAction(db, {
    matchId, userId: b, round: 1, action: "hold", commandKey: key("hold"), now: NOW + 11,
  });
  assert.equal(hold.accepted, true);
  const view = readMatchView(db, { matchId, viewerId: a, now: NOW + 11 });
  assert.equal(view.resolvedRounds, 1);
  assert.equal(view.me.mtmPpm, 100000);
  assert.equal(view.me.lockedAction, null);
  assert.equal(view.opponent.mtmPpm, 0);
  assert.equal(JSON.stringify(view).includes("600519"), false);

  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  const openView = readMatchView(db, { matchId, viewerId: a, now: match.round_opens_at });
  assert.equal(openView.me.canSell, true);
  assert.equal(openView.me.canBuy, false);
  assert.equal(openView.round, 2);
});

test("S01 a fresh heartbeat is not AFK, and a reconnect does not duplicate the action", () => {
  clearHeartbeats();
  const { a, b, matchId } = startMatch("s01");
  const deadline = NOW + 30_000;
  arm(matchId, { deadlineAt: deadline });
  noteHeartbeat(a, deadline - 45_000);
  noteHeartbeat(b, deadline - 45_001);
  const resolved = resolveIfDue(db, { matchId, now: deadline });
  assert.equal(resolved.advanced, true);
  const streaks = db.prepare(`SELECT user_id, afk_streak FROM pvp_match_players WHERE match_id = ?`).all(matchId);
  assert.equal(streaks.find((row) => row.user_id === a).afk_streak, 0);
  assert.equal(streaks.find((row) => row.user_id === b).afk_streak, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_actions WHERE match_id = ?`).get(matchId).c, 2);

  const reset = startMatch("reset");
  arm(reset.matchId);
  db.prepare(`UPDATE pvp_match_players SET afk_streak = 4 WHERE match_id = ? AND user_id = ?`).run(reset.matchId, reset.a);
  lockAction(db, { matchId: reset.matchId, userId: reset.a, round: 1, action: "hold", commandKey: key("me"), now: NOW + 5 });
  lockAction(db, { matchId: reset.matchId, userId: reset.b, round: 1, action: "hold", commandKey: key("them"), now: NOW + 6 });
  assert.equal(
    db.prepare(`SELECT afk_streak FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(reset.matchId, reset.a).afk_streak,
    0
  );

  const kept = startMatch("kept");
  arm(kept.matchId, { deadlineAt: deadline });
  db.prepare(`UPDATE pvp_match_players SET afk_streak = 2 WHERE match_id = ? AND user_id = ?`).run(kept.matchId, kept.a);
  noteHeartbeat(kept.a, deadline);
  resolveIfDue(db, { matchId: kept.matchId, now: deadline });
  assert.equal(
    db.prepare(`SELECT afk_streak FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(kept.matchId, kept.a).afk_streak,
    2
  );
});

test("S02 both players reaching AFK 5 void the match, and one side forfeits", () => {
  clearHeartbeats();
  const both = startMatch("both-afk");
  let cursor = NOW + 30_000;
  arm(both.matchId, { deadlineAt: cursor });
  for (let i = 0; i < 4; i++) {
    const step = resolveIfDue(db, { matchId: both.matchId, now: cursor });
    assert.equal(step.advanced, true, JSON.stringify(step));
    cursor = db.prepare(`SELECT round_deadline_at FROM pvp_matches WHERE id = ?`).get(both.matchId).round_deadline_at;
  }
  const ended = resolveIfDue(db, { matchId: both.matchId, now: cursor });
  assert.equal(ended.reason, "both_afk");
  assert.equal(settlementOf(both.matchId).terminal_type, "aborted");
  assert.equal(balanceOf(db, both.a), 500);
  assert.equal(balanceOf(db, both.b), 500);
  assert.equal(memberCount(both.matchId), 0);
  assert.equal(db.prepare(`SELECT resolved_rounds FROM pvp_matches WHERE id = ?`).get(both.matchId).resolved_rounds, 4);
  assert.equal(db.prepare(`SELECT user_id FROM pvp_ratings WHERE user_id = ?`).get(both.a), undefined);

  for (const afkSeat of ["a", "b"]) {
    clearHeartbeats();
    const match = startMatch(`one-${afkSeat}`);
    cursor = NOW + 30_000;
    arm(match.matchId, { deadlineAt: cursor });
    const afk = match[afkSeat];
    const live = afkSeat === "a" ? match.b : match.a;
    for (let i = 0; i < 4; i++) {
      noteHeartbeat(live, cursor);
      assert.equal(resolveIfDue(db, { matchId: match.matchId, now: cursor }).advanced, true);
      cursor = db.prepare(`SELECT round_deadline_at FROM pvp_matches WHERE id = ?`).get(match.matchId).round_deadline_at;
    }
    noteHeartbeat(live, cursor);
    const forfeited = resolveIfDue(db, { matchId: match.matchId, now: cursor });
    assert.equal(forfeited.reason, "afk");
    assert.equal(settlementOf(match.matchId).winner_user_id, live);
    assert.equal(balanceOf(db, live), 515);
    assert.equal(balanceOf(db, afk), 480);
    const view = readMatchView(db, { matchId: match.matchId, viewerId: live, now: cursor });
    assert.equal(view.identity, undefined);
    assert.equal(view.market.bars.length, 5);
    assert.equal(JSON.stringify(view).includes("600519"), false);
  }
});

test("a deadline missed by more than 5 seconds is a system void, even if both had locked", () => {
  const edge = startMatch("stall-edge");
  const deadline = NOW + 1_000;
  arm(edge.matchId, { deadlineAt: deadline });
  const timed = resolveIfDue(db, { matchId: edge.matchId, now: deadline + 5_000 });
  assert.equal(timed.advanced, true);
  assert.equal(settlementOf(edge.matchId), undefined);

  const stalled = startMatch("stall");
  arm(stalled.matchId, { deadlineAt: deadline });
  const late = resolveIfDue(db, { matchId: stalled.matchId, now: deadline + 5_001 });
  assert.equal(late.reason, "system_stall");
  assert.equal(balanceOf(db, stalled.a), 500);
  assert.equal(balanceOf(db, stalled.b), 500);
  assert.equal(db.prepare(`SELECT resolved_rounds FROM pvp_matches WHERE id = ?`).get(stalled.matchId).resolved_rounds, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_rounds WHERE match_id = ?`).get(stalled.matchId).c, 0);

  const locked = startMatch("stall-locked");
  arm(locked.matchId, { deadlineAt: deadline });
  const insert = db.prepare(
    `INSERT INTO pvp_actions (match_id, user_id, round, action, source, locked_at)
     VALUES (?, ?, 1, 'hold', 'player', ?)`
  );
  insert.run(locked.matchId, locked.a, deadline - 1);
  insert.run(locked.matchId, locked.b, deadline - 1);
  const ignored = resolveIfDue(db, { matchId: locked.matchId, now: deadline + 5_001 });
  assert.equal(ignored.reason, "system_stall");
  assert.equal(db.prepare(`SELECT actions_json FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(locked.matchId, locked.a).actions_json, "[]");
  assert.equal(balanceOf(db, locked.a), 500);
});

test("a broken snapshot aborts and refunds instead of publishing a score", () => {
  const { a, b, matchId } = startMatch("bad-bars");
  arm(matchId);
  db.prepare(`UPDATE pvp_matches SET snapshot_json = ? WHERE id = ?`).run(JSON.stringify({ bars: [], history: [] }), matchId);
  const ended = resolveIfDue(db, { matchId, now: NOW + 30_000 });
  assert.equal(ended.reason, "mtm_mismatch");
  assert.equal(balanceOf(db, a), 500);
  assert.equal(balanceOf(db, b), 500);
  assert.equal(pvpLedger(db, matchId).filter((row) => row.reason === "pvp_refund").length, 2);
});

test("an unavailable account forfeits, and two unavailable accounts void", () => {
  const one = startMatch("down");
  arm(one.matchId);
  db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(one.b);
  const closed = lockAction(db, {
    matchId: one.matchId, userId: one.a, round: 1, action: "buy", commandKey: key("down"), now: NOW + 5,
  });
  assert.equal(closed.code, "ACCOUNT_UNAVAILABLE");
  assert.equal(settlementOf(one.matchId).reason, "account_unavailable");
  assert.equal(settlementOf(one.matchId).winner_user_id, one.a);
  assert.equal(balanceOf(db, one.a), 515);
  assert.equal(balanceOf(db, one.b), 480);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_actions WHERE match_id = ?`).get(one.matchId).c, 0);

  const both = startMatch("both-down");
  arm(both.matchId, { deadlineAt: NOW + 30_000 });
  db.prepare(`UPDATE users SET status = 'disabled' WHERE id IN (?, ?)`).run(both.a, both.b);
  const voided = resolveIfDue(db, { matchId: both.matchId, now: NOW + 30_000 });
  assert.equal(voided.reason, "both_unavailable");
  assert.equal(balanceOf(db, both.a), 500);
  assert.equal(balanceOf(db, both.b), 500);
  assert.equal(db.prepare(`SELECT user_id FROM pvp_ratings WHERE user_id = ?`).get(both.a), undefined);
});

test("the last round completes once, and a forfeit does not fill an unrevealed lock", () => {
  const done = startMatch("draw");
  arm(done.matchId, { rounds: 28, opensAt: NOW, deadlineAt: NOW + 30_000 });
  lockAction(db, { matchId: done.matchId, userId: done.a, round: 29, action: "hold", commandKey: key("a29"), now: NOW + 5 });
  const second = lockAction(db, {
    matchId: done.matchId, userId: done.b, round: 29, action: "hold", commandKey: key("b29"), now: NOW + 6,
  });
  assert.equal(second.accepted, true);
  assert.equal(settlementOf(done.matchId).reason, "completed_draw");
  assert.equal(balanceOf(db, done.a), 500);
  assert.equal(balanceOf(db, done.b), 500);
  const revealed = readMatchView(db, { matchId: done.matchId, viewerId: done.a, now: NOW + 6 });
  assert.equal(revealed.identity.stockCode, "600519");
  assert.equal(revealed.market.bars.length, 30);
  const again = forfeitMatch(db, { matchId: done.matchId, userId: done.a, commandKey: key("late-ff"), now: NOW + 7 });
  assert.equal(again.unchanged, true);
  assert.equal(again.forfeited, false);
  assert.equal(pvpLedger(db, done.matchId).filter((row) => row.reason === "pvp_reward").length, 0);

  const quit = startMatch("ff");
  arm(quit.matchId);
  lockAction(db, { matchId: quit.matchId, userId: quit.a, round: 1, action: "buy", commandKey: key("pend"), now: NOW + 5 });
  const command = key("ff");
  const first = forfeitMatch(db, { matchId: quit.matchId, userId: quit.a, commandKey: command, now: NOW + 6 });
  assert.equal(first.forfeited, true);
  const replay = forfeitMatch(db, { matchId: quit.matchId, userId: quit.a, commandKey: command, now: NOW + 60_000 });
  assert.deepEqual(replay, first);
  assert.equal(settlementOf(quit.matchId).winner_user_id, quit.b);
  assert.equal(balanceOf(db, quit.b), 515);
  assert.equal(balanceOf(db, quit.a), 480);
  const view = readMatchView(db, { matchId: quit.matchId, viewerId: quit.b, now: NOW + 6 });
  assert.equal(view.identity, undefined);
  assert.equal(view.resolvedActions.length, 0);
  assert.equal(JSON.stringify(view).includes("600519"), false);
  assert.equal(resolveIfDue(db, { matchId: quit.matchId, now: NOW + 30_000 }).unchanged, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_settlements WHERE match_id = ?`).get(quit.matchId).c, 1);
});

test("C04 the last action, the timer, and a forfeit leave one settlement and one coin path", async () => {
  const sequential = startMatch("c04-seq");
  arm(sequential.matchId, { rounds: 28 });
  forfeitMatch(db, { matchId: sequential.matchId, userId: sequential.a, commandKey: key("seq"), now: NOW + 5 });
  resolveIfDue(db, { matchId: sequential.matchId, now: NOW + 30_000 });
  assert.equal(settlementOf(sequential.matchId).reason, "forfeit");
  assert.equal(pvpLedger(db, sequential.matchId).filter((row) => row.reason === "pvp_reward").length, 1);
  assert.equal(pvpLedger(db, sequential.matchId).filter((row) => row.reason === "pvp_refund").length, 0);

  const raced = startMatch("c04-race");
  const deadline = NOW + 30_000;
  arm(raced.matchId, { rounds: 28, deadlineAt: deadline });
  const worker = new Worker(new URL("./race-worker.mjs", import.meta.url), {
    workerData: {
      op: "forfeit",
      args: { matchId: raced.matchId, userId: raced.a, commandKey: key("race"), now: deadline },
    },
  });
  const workerResult = new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  const parentResult = resolveIfDue(db, { matchId: raced.matchId, now: deadline });
  const other = await workerResult;
  assert.equal(other.ok, true, other.message);
  assert.equal(parentResult.ok, true, JSON.stringify(parentResult));
  const rows = db.prepare(`SELECT * FROM pvp_settlements WHERE match_id = ?`).all(raced.matchId);
  assert.equal(rows.length, 1);
  const ledger = pvpLedger(db, raced.matchId);
  if (rows[0].reason === "forfeit") {
    assert.equal(balanceOf(db, raced.a), 480);
    assert.equal(balanceOf(db, raced.b), 515);
    assert.equal(ledger.filter((row) => row.reason === "pvp_reward").length, 1);
    assert.equal(ledger.filter((row) => row.reason === "pvp_refund").length, 0);
  } else if (rows[0].reason === "completed_draw") {
    assert.equal(balanceOf(db, raced.a), 500);
    assert.equal(balanceOf(db, raced.b), 500);
    assert.equal(ledger.filter((row) => row.reason === "pvp_reward").length, 0);
    assert.equal(ledger.filter((row) => row.reason === "pvp_refund").length, 2);
  } else {
    assert.fail(rows[0].reason);
  }
  assert.equal(memberCount(raced.matchId), 0);
  resolveIfDue(db, { matchId: raced.matchId, now: deadline + 1 });
  forfeitMatch(db, { matchId: raced.matchId, userId: raced.b, commandKey: key("after"), now: deadline + 1 });
  assert.equal(pvpLedger(db, raced.matchId).length, ledger.length);
});

test("the due scan resolves a match the timer missed", () => {
  const { matchId } = startMatch("scan");
  arm(matchId, { deadlineAt: NOW + 30_000 });
  const scanned = scanDueMatches(db, NOW + 30_000);
  assert.equal(scanned.some((row) => row.matchId === matchId && row.advanced === true), true);
  assert.equal(db.prepare(`SELECT resolved_rounds FROM pvp_matches WHERE id = ?`).get(matchId).resolved_rounds, 1);
});

test("S03 a throw before commit leaves the charged match, and a committed forfeit is not refunded again", () => {
  const crashed = startMatch("crash");
  arm(crashed.matchId, { deadlineAt: NOW + 30_000 });
  setCommitBarrier(() => {
    throw new Error("crash-before-commit");
  });
  try {
    assert.throws(() => resolveIfDue(db, { matchId: crashed.matchId, now: NOW + 30_000 }), /crash-before-commit/);
  } finally {
    setCommitBarrier(null);
  }
  assert.equal(db.prepare(`SELECT status, resolved_rounds FROM pvp_matches WHERE id = ?`).get(crashed.matchId).status, "playing");
  assert.equal(settlementOf(crashed.matchId), undefined);
  assert.equal(balanceOf(db, crashed.a), 480);

  const kept = startMatch("kept-end");
  arm(kept.matchId);
  forfeitMatch(db, { matchId: kept.matchId, userId: kept.a, commandKey: key("keep"), now: NOW + 5 });
  assert.equal(balanceOf(db, kept.b), 515);
  const before = pvpLedger(db, kept.matchId).length;

  recoverOnBoot(db, { now: NOW + 80_000 });
  assert.equal(db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(crashed.matchId).terminal_reason, "boot_recovery");
  assert.equal(balanceOf(db, crashed.a), 500);
  assert.equal(balanceOf(db, crashed.b), 500);
  assert.equal(db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(kept.matchId).terminal_reason, "forfeit");
  assert.equal(balanceOf(db, kept.b), 515);
  assert.equal(pvpLedger(db, kept.matchId).length, before);
  const refunds = pvpLedger(db, crashed.matchId).filter((row) => row.reason === "pvp_refund").length;
  recoverOnBoot(db, { now: NOW + 90_000 });
  assert.equal(pvpLedger(db, crashed.matchId).filter((row) => row.reason === "pvp_refund").length, refunds);
});

test("S04 flag off still clears a stored playing match and refuses a new challenge", () => {
  const a = user("s04-a");
  const b = user("s04-b");
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("s04"), now: NOW });
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const waitingId = accepted.matchId;

  const playing = startMatch("boot-play");
  arm(playing.matchId);
  const outsider = user("s04-out");
  const pair = a < outsider ? `${a}:${outsider}` : `${outsider}:${a}`;
  const challengeId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pvp_challenges (
      id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, 'hash', ?, ?)`
  ).run(challengeId, a, outsider, pair, key("old"), NOW, NOW - 1);

  config.pvpBattleEnabled = false;
  try {
    const denied = createChallenge(db, {
      fromUserId: playing.a, toUserId: playing.b, createKey: key("off"), now: NOW + 10_000,
    });
    assert.equal(denied.code, "FEATURE_DISABLED");
    recoverOnBoot(db, { now: NOW + 100_000 });
    assert.equal(db.prepare(`SELECT status FROM pvp_challenges WHERE id = ?`).get(challengeId).status, "expired");
    assert.equal(db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(waitingId).terminal_reason, "boot_recovery");
    assert.equal(balanceOf(db, a), 500);
    assert.equal(pvpLedger(db, waitingId).length, 0);
    assert.equal(db.prepare(`SELECT terminal_reason FROM pvp_matches WHERE id = ?`).get(playing.matchId).terminal_reason, "boot_recovery");
    assert.equal(balanceOf(db, playing.a), 500);
    assert.equal(balanceOf(db, playing.b), 500);
    const view = readMatchView(db, { matchId: playing.matchId, viewerId: playing.a, now: NOW + 100_000 });
    assert.equal(view.status, "aborted");
    assert.equal(view.identity, undefined);
    assert.equal(JSON.stringify(view).includes("600519"), false);
    assert.equal(readMatchView(db, { matchId: playing.matchId, viewerId: outsider, now: NOW }), null);
    const quit = forfeitMatch(db, {
      matchId: playing.matchId, userId: playing.a, commandKey: key("still"), now: NOW + 100_000,
    });
    assert.equal(quit.unchanged, true);
  } finally {
    config.pvpBattleEnabled = true;
  }
});
