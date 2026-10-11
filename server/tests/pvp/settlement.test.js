import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { NOW, balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { shanghaiYmd } = await import("../../src/lib/jiuCoin.js");
const { acceptChallenge, createChallenge, markReady, pairKey } = await import("../../src/lib/pvp/challenges.js");
const { assessEntry } = await import("../../src/lib/pvp/eligibility.js");
const { finishMatch } = await import("../../src/lib/pvp/settlement.js");

config.pvpBattleEnabled = true;
migrate();
const db = openDb();
let keyN = 0;

test.after(() => closeDb());

function key(label) {
  keyN += 1;
  return `settle-${label}-${keyN}-0123456789abcdef`;
}

function user(label, extra = {}) {
  return seedUser(db, { name: `${label}-${crypto.randomUUID()}`, ...extra });
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

function insertStarted(fromId, toId, { reason = "completed_return", status = "settled", startedAt = NOW - 1000 } = {}) {
  const challengeId = crypto.randomUUID();
  const matchId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pvp_challenges (
      id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at, responded_at
    ) VALUES (?, ?, ?, ?, 'accepted', ?, 'hash', ?, ?, ?)`
  ).run(challengeId, fromId, toId, pairKey(fromId, toId), key("hist"), startedAt, startedAt, startedAt);
  const settled = status === "settled";
  db.prepare(
    `INSERT INTO pvp_matches (
      id, challenge_id, status, rule_version, pvp_version, rating_version, fill_mode,
      snapshot_json, snapshot_sha256, dataset_version, economy_json,
      terminal_reason, created_at, started_at, finished_at
    ) VALUES (?, ?, ?, 'sim30-mtm-v1', 'pvp-v1', 'pvp-elo-v1', 'next_open', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    matchId,
    challengeId,
    status,
    settled ? "{}" : null,
    settled ? "abc" : null,
    settled ? "pvp-test-ds" : null,
    settled ? '{"economyVersion":"pvp-eco-v1","entryCost":20,"winReward":35}' : null,
    reason,
    startedAt,
    startedAt,
    startedAt
  );
}

test("E04 eligibility does not take an IP, and a started clock is shared", () => {
  const a = user("e04a");
  const b = user("e04b");
  const gate = assessEntry(db, a, b, NOW);
  assert.equal(gate.ok, true);
  assert.equal(gate.rewardYmd, "2026-10-11");
  const { matchId } = startMatch("clock");
  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  assert.equal(match.round_opens_at, NOW + 2 + 1000);
  assert.equal(match.round_deadline_at - match.round_opens_at, 30_000);
  assert.equal(match.snapshot_json.includes("stockCode"), true);
  assert.equal(JSON.parse(match.economy_json).winReward, 35);
});

test("E01 E02 a win pays 35 once, and a later reward config does not rewrite it", () => {
  const { a, b, matchId } = startMatch("win");
  const previous = config.pvpWinReward;
  config.pvpWinReward = 99;
  let first;
  try {
    for (let i = 0; i < 10; i++) {
      const result = finishMatch(db, {
        matchId,
        terminalType: "completed",
        reason: "unused",
        metrics: {
          [a]: { returnPpm: 100000, mddPpm: 1000 },
          [b]: { returnPpm: 0, mddPpm: 1000 },
        },
        now: NOW + 50_000,
      });
      if (i === 0) first = result;
      else assert.equal(result.unchanged, true);
    }
  } finally {
    config.pvpWinReward = previous;
  }
  assert.equal(first.winnerUserId, a);
  assert.equal(first.reason, "completed_return");
  assert.equal(balanceOf(db, a), 515);
  assert.equal(balanceOf(db, b), 480);
  const ledger = pvpLedger(db, matchId);
  assert.deepEqual(
    ledger.map((row) => [row.user_id, row.delta, row.reason]),
    [
      [a, -20, "pvp_entry"],
      [b, -20, "pvp_entry"],
      [a, 35, "pvp_reward"],
    ]
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_settlements WHERE match_id = ?`).get(matchId).c, 1);
  const coins = db.prepare(`SELECT user_id, coin_delta, outcome FROM pvp_match_players WHERE match_id = ?`).all(matchId);
  assert.deepEqual(
    coins.find((row) => row.user_id === a),
    { user_id: a, coin_delta: 15, outcome: "win" }
  );
  assert.equal(coins.find((row) => row.user_id === b).coin_delta, -20);
  assert.equal(
    db.prepare(`SELECT ymd, win_reward_count AS c FROM pvp_reward_days WHERE user_id = ?`).get(a).ymd,
    "2026-10-11"
  );
  assert.notEqual(shanghaiYmd(new Date(NOW + 20 * 60 * 60 * 1000)), "2026-10-11");
});

test("a draw refunds both entries and a system abort refunds only once", () => {
  const drawn = startMatch("draw");
  const draw = finishMatch(db, {
    matchId: drawn.matchId,
    terminalType: "completed",
    reason: "unused",
    metrics: {
      [drawn.a]: { returnPpm: 10, mddPpm: 5 },
      [drawn.b]: { returnPpm: 10, mddPpm: 5 },
    },
    now: NOW + 10_000,
  });
  assert.equal(draw.winnerUserId, null);
  assert.equal(draw.reason, "completed_draw");
  assert.equal(balanceOf(db, drawn.a), 500);
  assert.equal(balanceOf(db, drawn.b), 500);
  assert.equal(
    db.prepare(`SELECT win_reward_count AS c FROM pvp_reward_days WHERE user_id = ?`).get(drawn.a),
    undefined
  );

  const aborted = startMatch("abort");
  for (let i = 0; i < 10; i++) {
    const result = finishMatch(db, {
      matchId: aborted.matchId,
      terminalType: "aborted",
      reason: "boot_recovery",
      now: NOW + 10_000,
    });
    if (i > 0) assert.equal(result.unchanged, true);
  }
  assert.equal(balanceOf(db, aborted.a), 500);
  assert.equal(balanceOf(db, aborted.b), 500);
  assert.equal(pvpLedger(db, aborted.matchId).filter((row) => row.reason === "pvp_refund").length, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_settlements WHERE match_id = ?`).get(aborted.matchId).c, 1);
  assert.equal(
    db.prepare(`SELECT games FROM pvp_ratings WHERE user_id = ?`).get(aborted.a),
    undefined
  );
});

test("E03 reward cap, pair limit, and system voids", () => {
  const capped = startMatch("cap");
  db.prepare(`INSERT INTO pvp_reward_days (user_id, ymd, win_reward_count) VALUES (?, '2026-10-11', 9)`).run(capped.a);
  finishMatch(db, {
    matchId: capped.matchId,
    terminalType: "completed",
    reason: "unused",
    metrics: {
      [capped.a]: { returnPpm: 1, mddPpm: 1 },
      [capped.b]: { returnPpm: 0, mddPpm: 1 },
    },
    now: Date.parse("2026-10-11T16:30:00.000Z"),
  });
  const reward = db.prepare(`SELECT ymd, win_reward_count AS c FROM pvp_reward_days WHERE user_id = ?`).get(capped.a);
  assert.equal(reward.ymd, "2026-10-11");
  assert.equal(reward.c, 10);
  const again = createChallenge(db, {
    fromUserId: capped.a,
    toUserId: user("cap-next"),
    createKey: key("cap-next"),
    now: NOW,
  });
  assert.equal(again.code, "REWARD_CAP");

  const a = user("pair-a");
  const b = user("pair-b");
  insertStarted(a, b);
  insertStarted(a, b);
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("pair"), now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created));
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  insertStarted(a, b);
  assert.equal(markReady(db, { matchId: accepted.matchId, userId: a, now: NOW + 1 }).waiting, true);
  const blocked = markReady(db, { matchId: accepted.matchId, userId: b, now: NOW + 2 });
  assert.equal(blocked.code, "PAIR_LIMIT");
  assert.equal(balanceOf(db, a), 500);
  assert.equal(balanceOf(db, b), 500);

  const c = user("void-a");
  const d = user("void-b");
  insertStarted(c, d, { reason: "boot_recovery", status: "aborted" });
  insertStarted(c, d, { reason: "system_stall", status: "aborted" });
  insertStarted(c, d, { reason: "system_restart", status: "aborted" });
  const open = createChallenge(db, { fromUserId: c, toUserId: d, createKey: key("void"), now: NOW });
  assert.equal(open.ok, true, JSON.stringify(open));
});

test("P01 a floored forfeit stores the actual delta", () => {
  const a = user("floor-a");
  const b = user("floor-b");
  const stamp = NOW - 10_000;
  for (const id of [a, b]) {
    db.prepare(
      `INSERT INTO pvp_ratings (
        user_id, rating, games, wins, losses, draws, completed_games, completed_return_sum_ppm, updated_at
      ) VALUES (?, 700, 0, 0, 0, 0, 0, 0, ?)`
    ).run(id, stamp);
  }
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("floor"), now: NOW });
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  markReady(db, { matchId: accepted.matchId, userId: a, now: NOW + 1 });
  assert.equal(markReady(db, { matchId: accepted.matchId, userId: b, now: NOW + 2 }).started, true);
  const done = finishMatch(db, {
    matchId: accepted.matchId,
    terminalType: "forfeited",
    reason: "forfeit",
    winnerUserId: b,
    now: NOW + 3000,
  });
  assert.equal(done.ok, true);
  const rows = db.prepare(`SELECT user_id, actual_rating_delta, rating_after FROM pvp_match_players WHERE match_id = ?`).all(accepted.matchId);
  assert.equal(rows.find((row) => row.user_id === a).actual_rating_delta, 0);
  assert.equal(rows.find((row) => row.user_id === a).rating_after, 700);
  assert.equal(rows.find((row) => row.user_id === b).actual_rating_delta, 16);
  assert.equal(rows.find((row) => row.user_id === b).rating_after, 716);
});
