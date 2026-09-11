import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();

const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT, JIU_COIN_GAME_CREATE_COST } = await import("../src/lib/jiuCoin.js");
const {
  ECONOMY_VERSION,
  grantRewardClaim,
  deductRewardClaim,
  getRewardClaim,
  hasRewardClaim,
} = await import("../src/lib/rewardClaims.js");

const ctx = await startTestServer();
const { register, stop, api } = ctx;

test.after(async () => {
  await stop();
});

function ledgerFor(userId, reason) {
  return openDb()
    .prepare(
      `SELECT id, delta, balance_after, reason, meta_json FROM jiu_coin_ledger
       WHERE user_id = ? AND reason = ? ORDER BY id ASC`
    )
    .all(userId, reason);
}

test("migration creates reward_claims with unique (user_id, reward_key)", () => {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reward_claims'`
    )
    .get();
  assert.ok(row, "reward_claims table missing — expect 011_reward_claims.sql applied");

  const idx = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reward_claims'`
    )
    .get();
  assert.match(idx.sql, /UNIQUE\s*\(\s*user_id\s*,\s*reward_key\s*\)/i);
});

test("grantRewardClaim: grant once, idempotent replay, ledger reconciles", async () => {
  const auth = await register(`rcg${Date.now().toString(36)}`);
  const db = openDb();
  const key = `quiz:2026-09-11`;
  const amount = 20;

  const first = grantRewardClaim(db, {
    userId: auth.user.id,
    rewardKey: key,
    amount,
    reason: "quiz_daily_reward",
    ruleVersion: "quiz-v1",
    refType: "quiz",
    refId: "2026-09-11",
  });
  assert.equal(first.unchanged, false);
  assert.equal(first.balance, JIU_COIN_REGISTER_GRANT + amount);
  assert.equal(first.claim.rewardKey, key);
  assert.equal(first.claim.amount, amount);
  assert.equal(first.claim.economyVersion, ECONOMY_VERSION);
  assert.equal(first.claim.ruleVersion, "quiz-v1");
  assert.ok(first.ledgerId);

  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + amount);
  assert.equal(hasRewardClaim(auth.user.id, key), true);

  const second = grantRewardClaim(db, {
    userId: auth.user.id,
    rewardKey: key,
    amount: 999, // must be ignored — already claimed
    reason: "quiz_daily_reward",
  });
  assert.equal(second.unchanged, true);
  assert.equal(second.balance, JIU_COIN_REGISTER_GRANT + amount);
  assert.equal(second.claim.id, first.claim.id);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + amount);

  const rows = ledgerFor(auth.user.id, "quiz_daily_reward");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, amount);
  assert.equal(rows[0].id, first.ledgerId);

  const claim = getRewardClaim(auth.user.id, key);
  assert.equal(claim.ledgerId, rows[0].id);
});

test("deductRewardClaim: insufficient funds, then success, then idempotent", async () => {
  const auth = await register(`rcd${Date.now().toString(36)}`);
  const db = openDb();
  // Drain balance to 9 via admin-style update (helpers never trust client amounts).
  db.prepare(`UPDATE users SET jiu_coin_balance = 9 WHERE id = ?`).run(auth.user.id);

  const key = `game:${auth.user.id}:rewind:1`;
  let threw = null;
  try {
    deductRewardClaim(db, {
      userId: auth.user.id,
      rewardKey: key,
      amount: 50,
      reason: "game_rewind",
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw);
  assert.equal(threw.code, "INSUFFICIENT_FUNDS");
  assert.equal(threw.balance, 9);
  assert.equal(threw.required, 50);
  assert.equal(hasRewardClaim(auth.user.id, key), false);
  assert.equal(getJiuCoinBalance(auth.user.id), 9);
  assert.equal(ledgerFor(auth.user.id, "game_rewind").length, 0);

  db.prepare(`UPDATE users SET jiu_coin_balance = 100 WHERE id = ?`).run(auth.user.id);
  const first = deductRewardClaim(db, {
    userId: auth.user.id,
    rewardKey: key,
    amount: 50,
    reason: "game_rewind",
    refType: "game",
    refId: "g-test",
  });
  assert.equal(first.unchanged, false);
  assert.equal(first.balance, 50);
  assert.equal(first.claim.amount, 50);

  const second = deductRewardClaim(db, {
    userId: auth.user.id,
    rewardKey: key,
    amount: 50,
    reason: "game_rewind",
  });
  assert.equal(second.unchanged, true);
  assert.equal(second.balance, 50);
  assert.equal(getJiuCoinBalance(auth.user.id), 50);

  const rows = ledgerFor(auth.user.id, "game_rewind");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, -50);
});

test("rejects non-positive / non-integer amount (never trust client)", async () => {
  const auth = await register(`rcv${Date.now().toString(36)}`);
  const db = openDb();
  for (const amount of [0, -10, 1.5, "20", null]) {
    assert.throws(
      () =>
        grantRewardClaim(db, {
          userId: auth.user.id,
          rewardKey: `bad:${String(amount)}`,
          amount,
          reason: "quiz_daily_reward",
        }),
      (e) => e.code === "INVALID_REWARD_AMOUNT"
    );
  }
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT);
});

test("nested TX with outer business work stays atomic", async () => {
  const auth = await register(`rcx${Date.now().toString(36)}`);
  const db = openDb();
  const key = `puzzle:first-clear:chapter1-gate2`;

  const outer = db.transaction(() => {
    db.prepare(
      `UPDATE users SET nickname = ?, updated_at = datetime('now') WHERE id = ?`
    ).run("奖励探针", auth.user.id);
    return grantRewardClaim(db, {
      userId: auth.user.id,
      rewardKey: key,
      amount: 20,
      reason: "puzzle_first_clear",
      ruleVersion: "puzzle-ch1-v1",
    });
  });
  const result = outer();
  assert.equal(result.unchanged, false);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + 20);
  assert.equal(hasRewardClaim(auth.user.id, key), true);
  const nick = db.prepare(`SELECT nickname FROM users WHERE id = ?`).get(auth.user.id).nickname;
  assert.equal(nick, "奖励探针");
});

test("existing register / daily_claim / game_create paths still work", async () => {
  const auth = await register(`rco${Date.now().toString(36)}`);
  assert.equal(auth.user.jiuCoinBalance, JIU_COIN_REGISTER_GRANT);

  const daily = await api("/api/v1/me/jiu-coin/daily", {
    method: "POST",
    csrf: auth.csrfToken,
  });
  assert.equal(daily.status, 200, JSON.stringify(daily.json));
  const amt = daily.json.data.amount;
  assert.ok(amt >= 50 && amt <= 200);

  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rc-game-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, priceStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + amt - JIU_COIN_GAME_CREATE_COST);

  // No accidental reward_claims rows for legacy paths
  const n = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM reward_claims WHERE user_id = ?`)
    .get(auth.user.id).c;
  assert.equal(n, 0);
});
