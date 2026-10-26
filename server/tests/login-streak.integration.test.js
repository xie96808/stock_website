import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.LOGIN_STREAK_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const { planClaim, STREAK_COINS } = await import("../src/lib/loginStreak.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => {
  delete process.env.STOCKGAME_NOW_MS;
  await stop();
});

/** Noon Shanghai on 2026-11-<d> (STOCKGAME_NOW_MS is how the daily-challenge tests inject the clock). */
function setDay(d) {
  process.env.STOCKGAME_NOW_MS = String(Date.parse(`2026-11-${String(d).padStart(2, "0")}T12:00:00+08:00`));
}
const claim = (auth) => api("/api/v1/me/streak/claim", { method: "POST", csrf: auth.csrfToken, body: {} });
const state = async () => (await api("/api/v1/me/streak")).json.data;

test("planClaim: first claim, consecutive, wrap after day 7, break steps back one tier", () => {
  assert.deepEqual(planClaim(null, "2026-11-01"), { claimable: true, day: 1, run: 1, wrapped: false, broken: false });
  const row = (pos, run, last) => ({ cycle_pos: pos, run_days: run, last_claim_date: last });
  assert.equal(planClaim(row(1, 1, "2026-11-01"), "2026-11-01").claimable, false);
  assert.equal(planClaim(row(2, 2, "2026-11-01"), "2026-11-02").day, 3);
  const wrap = planClaim(row(7, 7, "2026-11-07"), "2026-11-08");
  assert.deepEqual([wrap.day, wrap.run, wrap.wrapped], [1, 8, true]);
  const broke = planClaim(row(5, 5, "2026-11-01"), "2026-11-04");
  assert.deepEqual([broke.day, broke.run, broke.broken], [4, 1, true]);
  assert.equal(planClaim(row(1, 1, "2026-11-01"), "2026-11-09").day, 1, "never below day 1");
  // month / year boundary stays consecutive
  assert.equal(planClaim(row(3, 3, "2026-12-31"), "2027-01-01").day, 4);
});

test("anonymous is rejected; flag off hides it without 404 noise", async () => {
  setDay(1);
  assert.equal((await api("/api/v1/me/streak")).status, 401);
  const a = await register("streakoff");
  config.loginStreakEnabled = false;
  try {
    const g = await api("/api/v1/me/streak");
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.data, { enabled: false });
    const c = await claim(a);
    assert.equal(c.status, 404);
    assert.equal(c.json.error.code, "FEATURE_DISABLED");
    assert.equal(getJiuCoinBalance(a.user.id), JIU_COIN_REGISTER_GRANT);
  } finally {
    config.loginStreakEnabled = true;
  }
});

test("a 7-day run pays 20→60, day 7 adds a wheel spin, day 8 starts the next cycle", async () => {
  config.luckyWheelEnabled = true;
  const a = await register("streakrun");
  const uid = a.user.id;
  setDay(1);
  let s = await state();
  assert.equal(s.enabled, true);
  assert.equal(s.claimedToday, false);
  assert.deepEqual(s.next, { coins: 20, spins: 0 });
  assert.equal(s.rewards.length, 7);

  let expected = JIU_COIN_REGISTER_GRANT;
  for (let d = 1; d <= 7; d++) {
    setDay(d);
    const r = await claim(a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const c = r.json.data.claimed;
    assert.equal(c.day, d);
    assert.equal(c.run, d);
    assert.equal(c.coins, STREAK_COINS[d - 1]);
    assert.equal(c.spins, d === 7 ? 1 : 0);
    expected += STREAK_COINS[d - 1];
    assert.equal(c.balance, expected);
    assert.equal(r.json.data.state.claimedToday, true);
  }
  assert.equal(getJiuCoinBalance(uid), expected);
  const db = openDb();
  const grant = db.prepare(`SELECT spins, source_key, expires_date FROM lucky_wheel_credit_grants WHERE user_id = ?`).all(uid);
  assert.equal(grant.length, 1);
  assert.equal(grant[0].spins, 1);
  assert.equal(grant[0].source_key, `streak:${uid}:2026-11-07`);
  assert.equal(grant[0].expires_date, "2026-11-14");

  setDay(8);
  const r8 = await claim(a);
  assert.equal(r8.status, 200);
  assert.equal(r8.json.data.claimed.day, 1);
  assert.equal(r8.json.data.claimed.run, 8);
  const st = db.prepare(`SELECT cycles_done, best_run, total_claims FROM login_streaks WHERE user_id = ?`).get(uid);
  assert.deepEqual({ ...st }, { cycles_done: 1, best_run: 8, total_claims: 8 });
  config.luckyWheelEnabled = false;
});

test("same-day claim is idempotent (409, one ledger row, balance unchanged)", async () => {
  const a = await register("streakdup");
  setDay(1);
  assert.equal((await claim(a)).status, 200);
  const again = await claim(a);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_CLAIMED_TODAY");
  assert.equal(again.json.error.details.claimedToday, true);
  assert.equal(getJiuCoinBalance(a.user.id), JIU_COIN_REGISTER_GRANT + 20);
  const n = openDb().prepare(`SELECT COUNT(*) c FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'streak_claim'`).get(a.user.id).c;
  assert.equal(n, 1);
  assert.equal((await state()).claimedToday, true);
});

test("concurrent taps pay once", async () => {
  const a = await register("streakrace");
  setDay(1);
  const rs = await Promise.all([claim(a), claim(a), claim(a), claim(a)]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join());
  assert.equal(rs.filter((r) => r.status === 409).length, 3);
  assert.equal(getJiuCoinBalance(a.user.id), JIU_COIN_REGISTER_GRANT + 20);
});

test("missing days steps back one tier instead of resetting; run restarts", async () => {
  const a = await register("streakgap");
  for (const d of [1, 2, 3, 4]) {
    setDay(d);
    assert.equal((await claim(a)).status, 200);
  }
  setDay(9); // missed 5..8
  const s = await state();
  assert.equal(s.broken, true);
  assert.equal(s.day, 3);
  assert.equal(s.runDays, 0);
  const r = await claim(a);
  assert.equal(r.json.data.claimed.day, 3);
  assert.equal(r.json.data.claimed.run, 1);
  assert.equal(r.json.data.claimed.coins, STREAK_COINS[2]);
  const best = openDb().prepare(`SELECT best_run FROM login_streaks WHERE user_id = ?`).get(a.user.id).best_run;
  assert.equal(best, 4);
});

test("no bonus spin when the wheel is off (day 7 still pays coins)", async () => {
  config.luckyWheelEnabled = false;
  const a = await register("streaknowheel");
  for (let d = 1; d <= 7; d++) {
    setDay(d);
    const r = await claim(a);
    assert.equal(r.status, 200);
    if (d === 7) assert.equal(r.json.data.claimed.spins, 0);
  }
  const n = openDb().prepare(`SELECT COUNT(*) c FROM lucky_wheel_credit_grants WHERE user_id = ?`).get(a.user.id).c;
  assert.equal(n, 0);
});

test("GET /config exposes the flag", async () => {
  const r = await api("/api/v1/config");
  assert.equal(r.json.data.features.loginStreak, true);
});
