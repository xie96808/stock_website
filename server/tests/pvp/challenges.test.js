import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { NOW, balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const {
  acceptChallenge,
  cancelReady,
  createChallenge,
  expireDueReady,
  markReady,
  pairKey,
} = await import("../../src/lib/pvp/challenges.js");
const { blockUser } = await import("../../src/lib/pvp/eligibility.js");
const { READY_MS } = await import("../../src/lib/pvp/config.js");

config.pvpBattleEnabled = true;

migrate();
const db = openDb();
let keyN = 0;

test.after(() => closeDb());

function key(label) {
  keyN += 1;
  return `key-${label}-${keyN}-0123456789abcdef`;
}

function user(label, extra = {}) {
  return seedUser(db, { name: `${label}-${crypto.randomUUID()}`, ...extra });
}

test("C01 a mutual challenge stays one pending until the recipient accepts", () => {
  const a = user("c01a");
  const b = user("c01b");
  const first = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("ab"), now: NOW });
  const back = createChallenge(db, { fromUserId: b, toUserId: a, createKey: key("ba"), now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(back.ok, true);
  assert.equal(back.alreadyPending, true);
  assert.equal(back.challenge.id, first.challenge.id);
  assert.equal(back.challenge.status, "pending");

  const replay = createChallenge(db, { fromUserId: a, toUserId: b, createKey: first.challenge.create_key, now: NOW });
  assert.equal(replay.replay, true);
  assert.equal(replay.challenge.id, first.challenge.id);

  const clash = createChallenge(db, {
    fromUserId: a,
    toUserId: user("c01c"),
    createKey: first.challenge.create_key,
    now: NOW,
  });
  assert.equal(clash.code, "IDEMPOTENCY_CONFLICT");

  assert.equal(acceptChallenge(db, { challengeId: first.challenge.id, userId: a, now: NOW }).code, "NOT_PARTICIPANT");
  const accepted = acceptChallenge(db, { challengeId: first.challenge.id, userId: b, now: NOW });
  assert.equal(accepted.ok, true);
  assert.equal(balanceOf(db, a), 500);
  assert.equal(balanceOf(db, b), 500);
  assert.equal(pvpLedger(db, accepted.matchId).length, 0);
  assert.equal(
    db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(accepted.matchId).status,
    "waiting_ready"
  );
});

test("C02 one accept locks the recipient; the other challenge does not charge", () => {
  const a = user("c02a");
  const b = user("c02b");
  const c = user("c02c");
  const toB = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("a2b"), now: NOW });
  const alsoB = createChallenge(db, { fromUserId: c, toUserId: b, createKey: key("c2b"), now: NOW });
  assert.equal(toB.ok, true);
  assert.equal(alsoB.ok, true);
  const won = acceptChallenge(db, { challengeId: toB.challenge.id, userId: b, now: NOW });
  const lost = acceptChallenge(db, { challengeId: alsoB.challenge.id, userId: b, now: NOW });
  assert.equal(won.ok, true);
  assert.equal(lost.ok, false);
  assert.equal(lost.code, "CHALLENGE_CLOSED");
  assert.equal(balanceOf(db, a), 500);
  assert.equal(balanceOf(db, b), 500);
  assert.equal(balanceOf(db, c), 500);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS c FROM pvp_active_members WHERE user_id = ?`).get(b).c,
    1
  );

  const pendingId = crypto.randomUUID();
  const outsider = user("c02d");
  db.prepare(
    `INSERT INTO pvp_challenges (
      id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, 'hash', ?, ?)`
  ).run(pendingId, outsider, b, pairKey(outsider, b), key("late"), NOW, NOW + 20_000);
  const busy = acceptChallenge(db, { challengeId: pendingId, userId: b, now: NOW });
  assert.equal(busy.code, "TARGET_BUSY");
  assert.equal(
    db.prepare(`SELECT status FROM pvp_challenges WHERE id = ?`).get(pendingId).status,
    "pending"
  );
  assert.equal(balanceOf(db, b), 500);
});

test("C03 ready timeout, cancel, and a poor second player leave both balances untouched", () => {
  const a = user("c03a");
  const b = user("c03b");
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("time"), now: NOW });
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  expireDueReady(db, NOW + READY_MS);
  const expired = db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(accepted.matchId);
  assert.equal(expired.status, "aborted");
  assert.equal(expired.terminal_reason, "ready_timeout");
  assert.equal(pvpLedger(db, accepted.matchId).length, 0);
  assert.equal(balanceOf(db, a), 500);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS c FROM pvp_active_members WHERE match_id = ?`).get(accepted.matchId).c,
    0
  );

  const a2 = user("c03a2");
  const b2 = user("c03b2");
  const created2 = createChallenge(db, { fromUserId: a2, toUserId: b2, createKey: key("cancel"), now: NOW });
  const accepted2 = acceptChallenge(db, { challengeId: created2.challenge.id, userId: b2, now: NOW });
  const cancelled = cancelReady(db, { matchId: accepted2.matchId, userId: a2, now: NOW + 1 });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.reason, "ready_cancelled");
  assert.equal(balanceOf(db, a2), 500);
  assert.equal(pvpLedger(db, accepted2.matchId).length, 0);

  const a3 = user("c03a3");
  const b3 = user("c03b3");
  const created3 = createChallenge(db, { fromUserId: a3, toUserId: b3, createKey: key("poor"), now: NOW });
  const accepted3 = acceptChallenge(db, { challengeId: created3.challenge.id, userId: b3, now: NOW });
  db.prepare(`UPDATE users SET jiu_coin_balance = 10 WHERE id = ?`).run(b3);
  assert.equal(markReady(db, { matchId: accepted3.matchId, userId: a3, now: NOW + 1 }).waiting, true);
  const failed = markReady(db, { matchId: accepted3.matchId, userId: b3, now: NOW + 2 });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INSUFFICIENT_FUNDS");
  assert.equal(failed.balance, undefined);
  assert.equal(balanceOf(db, a3), 500);
  assert.equal(balanceOf(db, b3), 10);
  assert.equal(pvpLedger(db, accepted3.matchId).length, 0);
  assert.equal(
    db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(accepted3.matchId).status,
    "aborted"
  );
});

test("a block and a full room reject a new match without charging", () => {
  const a = user("block-a");
  const b = user("block-b");
  blockUser(db, b, a, NOW);
  const blocked = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("block"), now: NOW });
  assert.equal(blocked.code, "BLOCKED");

  const previous = config.pvpMaxActiveMatches;
  config.pvpMaxActiveMatches = 1;
  try {
    const holderA = user("cap-a");
    const holderB = user("cap-b");
    const held = createChallenge(db, { fromUserId: holderA, toUserId: holderB, createKey: key("held"), now: NOW });
    assert.equal(acceptChallenge(db, { challengeId: held.challenge.id, userId: holderB, now: NOW }).ok, true);
    const extraA = user("cap-c");
    const extraB = user("cap-d");
    const extra = createChallenge(db, { fromUserId: extraA, toUserId: extraB, createKey: key("extra"), now: NOW });
    const full = acceptChallenge(db, { challengeId: extra.challenge.id, userId: extraB, now: NOW });
    assert.equal(full.code, "CAPACITY");
    assert.equal(balanceOf(db, extraA), 500);
  } finally {
    config.pvpMaxActiveMatches = previous;
  }
});

test("a one-hour-old account can open a challenge, and a short classic history cannot", () => {
  const veteran = user("vet");
  const young = user("young", { createdAt: new Date(NOW - 60 * 60 * 1000).toISOString() });
  const short = user("short", { classics: 2 });
  assert.equal(
    createChallenge(db, { fromUserId: young, toUserId: veteran, createKey: key("young"), now: NOW }).ok,
    true
  );
  assert.equal(
    createChallenge(db, { fromUserId: short, toUserId: veteran, createKey: key("short"), now: NOW }).code,
    "NOT_ELIGIBLE"
  );
});

test("settled 韭币局 games count toward the 3-practice-games gate (开一局 now starts a stake game)", () => {
  const veteran = user("vet-stake");
  // 2 classic + 1 settled stake = 3 practice games → can challenge, and can be challenged.
  const newbie = user("stake-newbie", { classics: 2, stakes: 1 });
  assert.equal(
    createChallenge(db, { fromUserId: newbie, toUserId: veteran, createKey: key("stake-out"), now: NOW }).ok,
    true
  );
  const other = user("vet-stake-2");
  assert.equal(
    createChallenge(db, { fromUserId: other, toUserId: newbie, createKey: key("stake-in"), now: NOW }).ok,
    true
  );
  // Only stake games, all settled: still enough.
  const allStake = user("all-stake", { classics: 0, stakes: 3 });
  assert.equal(
    createChallenge(db, { fromUserId: allStake, toUserId: veteran, createKey: key("stake-only"), now: NOW + 1 }).ok,
    true
  );
});

test("abandoned / forfeited 韭币局 games do not count toward the gate", () => {
  const veteran = user("vet-forfeit");
  const quitter = user("stake-quitter", { classics: 2, abandonedStakes: 3 });
  const res = createChallenge(db, { fromUserId: quitter, toUserId: veteran, createKey: key("forfeit"), now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NOT_ELIGIBLE");
  assert.match(res.message, /3 局/);
});

test("expired pending challenges are swept and no longer block outbound", () => {
  const a = user("exp-a");
  const b = user("exp-b");
  const c = user("exp-c");
  const first = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("exp1"), now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  // Still pending in DB past expiry — createChallenge must expire then allow a new one.
  db.prepare(`UPDATE pvp_challenges SET expires_at = ? WHERE id = ?`).run(NOW - 1, first.challenge.id);
  const ghost = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("exp-replay"), now: NOW + 1 });
  assert.equal(ghost.alreadyPending, undefined);
  assert.equal(ghost.created, true);
  assert.notEqual(ghost.challenge.id, first.challenge.id);
  assert.equal(
    db.prepare(`SELECT status FROM pvp_challenges WHERE id = ?`).get(first.challenge.id).status,
    "expired"
  );
  const other = createChallenge(db, { fromUserId: a, toUserId: c, createKey: key("exp-other"), now: NOW + 2 });
  // outbound still pending (ghost) so this should be OUTBOUND_PENDING
  assert.equal(other.code, "OUTBOUND_PENDING");
});

