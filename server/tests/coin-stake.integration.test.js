import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
process.env.COIN_STAKE_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");
const { stakeSettlement } = await import("../../shared/stake.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => {
  await stop();
});

let seq = 0;
const key = (p) => `${p}-${Date.now()}-${++seq}`;
const pick = () => ({ stockIndex: 0, windowStartIndex: 30, historyLength: 30 });

function create(auth, stake, k = key("sc")) {
  return api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": k },
    body: { fillMode: "next_open", gameKind: "stake", stake, pick: pick() },
  });
}
function decide(auth, id, rev, action) {
  return api(`/api/v1/games/${id}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key("d") },
    body: { expectedRevision: rev, action },
  });
}
function finish(auth, id, k = key("f")) {
  return api(`/api/v1/games/${id}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": k },
    body: { finish: true, expectedRevision: 29 },
  });
}
async function playOut(auth, id, first = ["buy"]) {
  let rev = 0;
  for (let i = 0; i < 29; i++) {
    const a = first[i] || "hold";
    const r = await decide(auth, id, rev, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    rev++;
  }
}
const ledger = (uid, reason) =>
  openDb().prepare(`SELECT * FROM jiu_coin_ledger WHERE user_id = ? AND reason = ?`).all(uid, reason);

test("config advertises coinStake; invalid stakes rejected before any coin moves", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.coinStake, true);
  const auth = await register(`st${Date.now().toString(36)}`);
  const bal = getJiuCoinBalance(auth.user.id);
  for (const bad of [undefined, 9, 501, 10.5, "abc", -10, null]) {
    const r = await create(auth, bad);
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.json.error.code, "INVALID_STAKE");
  }
  assert.equal(getJiuCoinBalance(auth.user.id), bal);
});

test("escrow at create, same key replays without a second charge", async () => {
  const auth = await register(`es${Date.now().toString(36)}`);
  const bal = getJiuCoinBalance(auth.user.id);
  const k = key("esc");
  const r = await create(auth, 10, k);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.gameKind, "stake");
  assert.deepEqual(r.json.data.stake, { amount: 10, status: "open" });
  assert.equal(getJiuCoinBalance(auth.user.id), bal - 10);
  const again = await create(auth, 10, k);
  assert.equal(again.status, 200);
  assert.equal(getJiuCoinBalance(auth.user.id), bal - 10);
  const diff = await create(auth, 20, k);
  assert.equal(diff.status, 409);
  assert.equal(ledger(auth.user.id, "stake_escrow").length, 1);
});

test("insufficient funds → 402 with required = stake, no game left behind", async () => {
  const auth = await register(`if${Date.now().toString(36)}`);
  const db = openDb();
  db.prepare(`UPDATE users SET jiu_coin_balance = 15 WHERE id = ?`).run(auth.user.id);
  const r = await create(auth, 50);
  assert.equal(r.status, 402);
  assert.equal(r.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(r.json.error.details.required, 50);
  assert.equal(getJiuCoinBalance(auth.user.id), 15);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM game_sessions WHERE user_id = ?`).get(auth.user.id).c, 0);
});

test("third buy → STAKE_BUY_LIMIT; buy-sell-buy is fine", async () => {
  const auth = await register(`bl${Date.now().toString(36)}`);
  const id = (await create(auth, 20)).json.data.gameId;
  assert.equal((await decide(auth, id, 0, "buy")).status, 200);
  assert.equal((await decide(auth, id, 1, "hold")).status, 200);
  assert.equal((await decide(auth, id, 2, "sell")).status, 200);
  assert.equal((await decide(auth, id, 3, "buy")).status, 200); // second (last) buy
  assert.equal((await decide(auth, id, 4, "sell")).status, 200);
  const third = await decide(auth, id, 5, "buy");
  assert.equal(third.status, 409, JSON.stringify(third.json));
  assert.equal(third.json.error.code, "STAKE_BUY_LIMIT");
  assert.equal((await decide(auth, id, 5, "hold")).status, 200);
});

test("settle pays stake + profit − fee exactly once; replay and ledger idempotent", async () => {
  const auth = await register(`sp${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  const created = await create(auth, 100);
  const id = created.json.data.gameId;
  await playOut(auth, id);
  const fk = key("fin");
  const f = await finish(auth, id, fk);
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const exp = stakeSettlement(100, f.json.data.returnPpm);
  assert.deepEqual(
    { ...f.json.data.stake },
    { amount: 100, status: "settled", returnPpm: f.json.data.returnPpm, profit: exp.profit, fee: exp.fee, payout: exp.payout, net: exp.net }
  );
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - 100 + exp.payout);
  const f2 = await finish(auth, id, fk);
  assert.equal(f2.status, 200);
  assert.deepEqual(f2.json.data.stake, f.json.data.stake);
  const f3 = await finish(auth, id, key("fin-other"));
  assert.ok([200, 409].includes(f3.status));
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - 100 + exp.payout);
  assert.equal(ledger(auth.user.id, "stake_payout").length, exp.payout > 0 ? 1 : 0);
  // not on the classic practice board / stats
  const stats = await api("/api/v1/me/stats");
  assert.equal(stats.status, 200);
});

test("abandon forfeits the stake; no payout", async () => {
  const auth = await register(`ab${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  const id = (await create(auth, 30)).json.data.gameId;
  const ab = await api(`/api/v1/games/${id}/abandon`, { method: "POST", csrf: auth.csrfToken });
  assert.equal(ab.status, 204);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - 30);
  assert.equal(ledger(auth.user.id, "stake_payout").length, 0);
  const row = openDb().prepare(`SELECT status, payout FROM coin_stakes WHERE game_id = ?`).get(id);
  assert.equal(row.status, "forfeited");
  assert.equal(row.payout, 0);
});

test("stake games cannot be rewound", async () => {
  const auth = await register(`rw${Date.now().toString(36)}`);
  const id = (await create(auth, 10)).json.data.gameId;
  await decide(auth, id, 0, "buy");
  const r = await api(`/api/v1/games/${id}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key("rw") },
    body: { expectedRevision: 1, toDay: 1 },
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
});
