import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const {
  backfillActiveUsersOnce,
  getJiuCoinBalance,
  JIU_COIN_REGISTER_GRANT,
} = await import("../src/lib/jiuCoin.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

test.after(async () => {
  await stop();
});

async function promoteAdmin(userId) {
  openDb().prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(userId);
}

async function createGame(csrf, key, pick = { stockIndex: 0, windowStartIndex: 30, historyLength: 30 }) {
  return api("/api/v1/games", {
    method: "POST",
    csrf,
    headers: { "Idempotency-Key": key },
    body: { fillMode: "next_open", pick },
  });
}

test("register grant +1000 韭币", async () => {
  const auth = await register(`jc${Date.now().toString(36)}`);
  assert.equal(auth.user.jiuCoinBalance, JIU_COIN_REGISTER_GRANT);
  const me = await api("/api/v1/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.jiuCoinBalance, JIU_COIN_REGISTER_GRANT);
  const bal = await api("/api/v1/me/jiu-coin");
  assert.equal(bal.status, 200);
  assert.equal(bal.json.data.balance, JIU_COIN_REGISTER_GRANT);
  assert.equal(bal.json.data.claimedToday, false);
});

test("backfill idempotent for active users", async () => {
  // Simulate a pre-economy user: balance 0, no ledger rows.
  const auth = await register(`bf${Date.now().toString(36)}`);
  const db = openDb();
  db.prepare(`DELETE FROM jiu_coin_ledger WHERE user_id = ?`).run(auth.user.id);
  db.prepare(`UPDATE users SET jiu_coin_balance = 0 WHERE id = ?`).run(auth.user.id);
  assert.equal(getJiuCoinBalance(auth.user.id), 0);

  const first = backfillActiveUsersOnce(db);
  assert.ok(first.granted >= 1);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT);

  const second = backfillActiveUsersOnce(db);
  assert.equal(second.granted, 0);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT);

  const n = db
    .prepare(
      `SELECT COUNT(*) AS c FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'backfill_grant'`
    )
    .get(auth.user.id).c;
  assert.equal(n, 1);
});

test("create / resume / second create coin rules", async () => {
  const auth = await register(`gr${Date.now().toString(36)}`);
  const key1 = `ck-${Date.now()}-a`;
  const c1 = await createGame(auth.csrfToken, key1);
  assert.equal(c1.status, 201, JSON.stringify(c1.json));
  assert.equal(getJiuCoinBalance(auth.user.id), 990);

  const c1again = await createGame(auth.csrfToken, key1);
  assert.equal(c1again.status, 200);
  assert.equal(c1again.json.data.gameId, c1.json.data.gameId);
  assert.equal(getJiuCoinBalance(auth.user.id), 990);

  // Active game exists → conflict, no deduct
  const cBusy = await createGame(auth.csrfToken, `ck-${Date.now()}-busy`);
  assert.equal(cBusy.status, 409);
  assert.equal(cBusy.json.error.code, "ACTIVE_GAME_EXISTS");
  assert.equal(getJiuCoinBalance(auth.user.id), 990);

  // Abandon (no refund), then create again → deduct another 10
  const ab = await api(`/api/v1/games/${c1.json.data.gameId}/abandon`, {
    method: "POST",
    csrf: auth.csrfToken,
  });
  assert.equal(ab.status, 204);
  assert.equal(getJiuCoinBalance(auth.user.id), 990);

  const c2 = await createGame(auth.csrfToken, `ck-${Date.now()}-b`);
  assert.equal(c2.status, 201, JSON.stringify(c2.json));
  assert.equal(getJiuCoinBalance(auth.user.id), 980);
});

test("daily claim once per Asia/Shanghai date", async () => {
  const auth = await register(`dy${Date.now().toString(36)}`);
  const d1 = await api("/api/v1/me/jiu-coin/daily", { method: "POST", csrf: auth.csrfToken });
  assert.equal(d1.status, 200, JSON.stringify(d1.json));
  const amt = d1.json.data.amount;
  assert.ok(amt >= 50 && amt <= 200);
  assert.equal(d1.json.data.balance, 1000 + amt);
  assert.equal(d1.json.data.claimedToday, true);

  const d2 = await api("/api/v1/me/jiu-coin/daily", { method: "POST", csrf: auth.csrfToken });
  assert.equal(d2.status, 409);
  assert.equal(d2.json.error.code, "ALREADY_CLAIMED_TODAY");
  assert.equal(getJiuCoinBalance(auth.user.id), 1000 + amt);
});

test("admin adjust add/sub/set with reason + audit", async () => {
  const auth = await register(`ad${Date.now().toString(36)}`);
  await promoteAdmin(auth.user.id);

  const target = await register(`tg${Date.now().toString(36)}`);
  assert.equal(target.user.jiuCoinBalance, 1000);

  // Re-login as admin after target register (jar holds latest session).
  for (const k of Object.keys(jar)) delete jar[k];
  const login = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: auth.username, password: auth.password },
  });
  assert.equal(login.status, 200);
  const csrf = login.json.data.csrfToken;

  const reauth = await api("/api/v1/admin/reauth", {
    method: "POST",
    csrf,
    body: { password: auth.password },
  });
  assert.equal(reauth.status, 200, JSON.stringify(reauth.json));

  const add = await api(`/api/v1/admin/users/${target.user.id}/jiu-coin`, {
    method: "POST",
    csrf,
    body: { op: "add", amount: 50, reason: "测试加币" },
  });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.equal(add.json.data.balance, 1050);

  const sub = await api(`/api/v1/admin/users/${target.user.id}/jiu-coin`, {
    method: "POST",
    csrf,
    body: { op: "sub", amount: 20, reason: "测试扣币" },
  });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.data.balance, 1030);

  const set = await api(`/api/v1/admin/users/${target.user.id}/jiu-coin`, {
    method: "POST",
    csrf,
    body: { op: "set", amount: 42, reason: "测试设值" },
  });
  assert.equal(set.status, 200);
  assert.equal(set.json.data.balance, 42);

  const noReason = await api(`/api/v1/admin/users/${target.user.id}/jiu-coin`, {
    method: "POST",
    csrf,
    body: { op: "add", amount: 1 },
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.error.code, "REASON_REQUIRED");

  const detail = await api(`/api/v1/admin/users/${target.user.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.user.jiuCoinBalance, 42);

  const audits = await api("/api/v1/admin/audit-logs?action=jiu_coin.set");
  assert.equal(audits.status, 200);
  assert.ok(audits.json.data.items.some((a) => a.targetId === String(target.user.id)));
});

test("unauthenticated create rejected", async () => {
  for (const k of Object.keys(jar)) delete jar[k];
  const c = await api("/api/v1/games", {
    method: "POST",
    headers: { "Idempotency-Key": "anon-jc-1" },
    body: { fillMode: "next_open" },
  });
  assert.equal(c.status, 401);
});

test("insufficient funds rejects create with clear error", async () => {
  const auth = await register(`poor${Date.now().toString(36)}`);
  openDb().prepare(`UPDATE users SET jiu_coin_balance = 5 WHERE id = ?`).run(auth.user.id);
  const c = await createGame(auth.csrfToken, `poor-${Date.now()}`);
  assert.equal(c.status, 402);
  assert.equal(c.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(getJiuCoinBalance(auth.user.id), 5);
});
