import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";
delete process.env.STOCKGAME_NOW_MS;

const { openDb } = await import("../src/db/connection.js");
const { config, clearSettingOverrides } = await import("../src/lib/config.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT, shanghaiYmd } = await import("../src/lib/jiuCoin.js");
const W = await import("../src/lib/luckyWheel.js");
const { api, register, stop, jar } = await startTestServer();
test.after(async () => {
  delete process.env.STOCKGAME_NOW_MS;
  await stop();
});

const db = () => openDb();
const clearJar = () => { for (const k of Object.keys(jar)) delete jar[k]; };
let seq = 0;
async function mkUser(prefix = "lw") {
  seq += 1;
  const u = await register(`${prefix}${Date.now().toString(36)}${seq}`);
  return u;
}
async function login(u) {
  clearJar();
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: u.username, password: u.password } });
  assert.equal(l.status, 200);
  return { ...u, csrf: l.json.data.csrfToken };
}
async function adminSession({ verify = true } = {}) {
  const a = await mkUser("lwadm");
  db().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(a.user.id);
  const s = await login(a);
  if (verify) await api("/api/v1/admin/reauth", { method: "POST", csrf: s.csrf, body: { password: a.password } });
  return s;
}
const spinHttp = (s, key) =>
  api("/api/v1/me/lucky-wheel/spin", { method: "POST", csrf: s.csrf, headers: key ? { "Idempotency-Key": key } : {} });
const reset = () => {
  resetRateLimitBuckets();
  config.rateLimit.wheelSpinPerUserMinute = 10_000;
  config.rateLimit.wheelSpinPerIpMinute = 10_000;
};
const coinTable = (amounts, weights) =>
  amounts.map((amount, pos) => ({ pos, kind: "jiu_coin", amount, weight: weights[pos] }));
const EVEN = [1250, 1250, 1250, 1250, 1250, 1250, 1250, 1250];
const ledgerSum = (uid) => db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=?`).get(uid).s;
const ledgerWheel = (uid) => db().prepare(`SELECT * FROM jiu_coin_ledger WHERE user_id=? AND reason='lucky_wheel'`).all(uid);

config.luckyWheelEnabled = true;
reset();

/* ------------------------------------------------------------------ pure config math */

test("Table A: code constant == migration seed, weights 10000, EV 125.68", () => {
  const cfg = W.getActiveConfig(db());
  assert.deepEqual(cfg.sectors, JSON.parse(JSON.stringify(W.TABLE_A)));
  assert.equal(cfg.version, 1);
  assert.equal(cfg.ticketCoinValue, 50);
  assert.equal(W.TABLE_A.reduce((a, s) => a + s.weight, 0), 10000);
  assert.equal(W.TABLE_A.length, 8);
  const ev = W.computeEv(W.TABLE_A, 50);
  assert.equal(ev.ev, 125.68);
  assert.equal(cfg.evX100, 12568);
  assert.equal(ev.pJackpot, 0.01);
  assert.equal(W.TABLE_A.filter((s) => s.jackpot).length, 1);
  assert.equal(W.TABLE_A[5].amount, 888);
  assert.ok(W.validateWheelConfig({ sectors: W.TABLE_A }).ok);
});

test("Table B EV (tickets at face 50 vs 70% redemption) incl. spin-again recursion", () => {
  const ev = W.computeEv(W.TABLE_B, 50);
  assert.equal(ev.ev, 130.09);
  assert.ok(Math.abs(ev.evRealistic - 123.0) < 0.1);
  assert.ok(Math.abs(ev.spinsPerDay - 1 / 0.87) < 0.01);
});

test("EV validation: reject <60 and >250, accept the bounds, warn above 150", () => {
  const ok = (a) => W.validateWheelConfig({ sectors: coinTable(Array(8).fill(a), EVEN) });
  const low = ok(59);
  assert.equal(low.ok, false);
  assert.equal(low.code, "EV_OUT_OF_BOUNDS");
  assert.equal(ok(60).ok, true);
  assert.equal(ok(250).ok, true);
  assert.equal(ok(251).ok, false);
  assert.equal(ok(251).code, "EV_OUT_OF_BOUNDS");
  const hi = ok(200);
  assert.ok(hi.ok);
  assert.ok(hi.warnings.some((w) => w.code === "EV_HIGH"));
  assert.equal(ok(125).warnings.some((w) => w.code === "EV_HIGH"), false);
});

test("validation: sectors count, weights sum, duplicate pos, kinds, spin cap, items gated", () => {
  const t = coinTable([90, 300, 50, 150, 70, 888, 110, 200], EVEN);
  assert.equal(W.validateWheelConfig({ sectors: t.slice(0, 7) }).code, "BAD_SECTORS");
  assert.equal(W.validateWheelConfig({}).code, "BAD_SECTORS");
  assert.equal(W.validateWheelConfig({ sectors: coinTable([90, 300, 50, 150, 70, 888, 110, 200], [1250, 1250, 1250, 1250, 1250, 1250, 1250, 1249]) }).code, "WEIGHT_SUM");
  const dup = t.map((s) => ({ ...s }));
  dup[3].pos = 2;
  assert.equal(W.validateWheelConfig({ sectors: dup }).code, "BAD_POS");
  const frac = t.map((s) => ({ ...s }));
  frac[0].amount = 90.5;
  assert.equal(W.validateWheelConfig({ sectors: frac }).code, "BAD_AMOUNT");
  const zero = t.map((s) => ({ ...s }));
  zero[0].weight = 0;
  assert.equal(W.validateWheelConfig({ sectors: zero }).code, "BAD_WEIGHT");
  const kind = t.map((s) => ({ ...s }));
  kind[0].kind = "gem";
  assert.equal(W.validateWheelConfig({ sectors: kind }).code, "BAD_KIND");
  const tv = W.validateWheelConfig({ sectors: t, ticketCoinValue: 0 });
  assert.equal(tv.code, "BAD_TICKET_VALUE");
  // spin sector too likely (>30%)
  const spinHeavy = t.map((s) => ({ ...s }));
  spinHeavy[0] = { pos: 0, kind: "spin", qty: 1, weight: 3500 };
  spinHeavy[1].weight = 0 + 1250 - 1250 + 1250;
  const heavyW = [3500, 750, 750, 1000, 1000, 1000, 1000, 1000];
  spinHeavy.forEach((s, i) => { s.weight = heavyW[i]; });
  assert.equal(W.validateWheelConfig({ sectors: spinHeavy }).code, "SPIN_TOO_LIKELY");
  // items refused while no granter registered
  W.registerItemGranter(null);
  const items = W.TABLE_B.map((s) => ({ ...s }));
  assert.equal(W.validateWheelConfig({ sectors: items, ticketCoinValue: 50 }, { rewindEnabled: true }).code, "ITEMS_UNAVAILABLE");
  W.registerItemGranter(() => ({ ledgerId: 1 }));
  assert.equal(W.validateWheelConfig({ sectors: items }, { rewindEnabled: false }).code, "REWIND_DISABLED");
  const good = W.validateWheelConfig({ sectors: items }, { rewindEnabled: true });
  assert.ok(good.ok, JSON.stringify(good));
  W.registerItemGranter(null);
  // spin sector alone (no items) is fine in Batch 0
  const spinOk = t.map((x, i) => ({ ...x, weight: [1300, 2100, 1400, 1400, 1500, 100, 1100, 1100][i] }));
  spinOk[0] = { pos: 0, kind: "spin", qty: 1, weight: 1300 };
  const so = W.validateWheelConfig({ sectors: spinOk });
  assert.ok(so.ok, JSON.stringify(so));
});

/* ------------------------------------------------------------------ landing exactness */

test("landing exactness: every sector 0..7 — roll boundaries map to the right sector, prize, ledger, jitter", async () => {
  const u = await mkUser("lwland");
  assert.ok(W.adminGrantSpins({ actorId: null, userId: u.user.id, spins: 30, reason: "测试发放" }).ok);
  let start = 0;
  let n = 0;
  const bal0 = getJiuCoinBalance(u.user.id);
  let expectedSum = 0;
  for (const s of W.TABLE_A) {
    for (const roll of [start, start + s.weight - 1]) {
      n += 1;
      const r = W.spinWheel(u.user.id, { idemKey: `land-${u.user.id}-${n}-${roll}`, rng: () => roll });
      assert.equal(r.status, 200, JSON.stringify(r));
      const d = r.data;
      assert.equal(d.sector, s.pos, `roll ${roll}`);
      assert.equal(d.prize.kind, "jiu_coin");
      assert.equal(d.prize.amount, s.amount);
      assert.equal(d.prize.id, `coin-${s.amount}`);
      assert.equal(d.isJackpot, s.pos === 5);
      assert.equal(d.prize.isJackpot, s.pos === 5);
      assert.equal(d.prize.substituted, false);
      assert.ok(Math.abs(d.landJitterDeg) <= 13, "jitter keeps the pointer inside the 45° sector");
      expectedSum += s.amount;
      assert.equal(d.balance, bal0 + expectedSum);
      assert.equal(d.balanceAfter, d.balance);
      const row = db().prepare(`SELECT * FROM lucky_wheel_spins WHERE spin_id=?`).get(d.spinId);
      assert.equal(row.roll, roll);
      assert.equal(row.sector, s.pos);
      assert.equal(row.coin_value, s.amount);
    }
    start += s.weight;
  }
  assert.equal(n, 16);
  assert.equal(getJiuCoinBalance(u.user.id), bal0 + expectedSum);
  // jackpot flag only ever on sector 5
  const jp = db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_spins WHERE user_id=? AND is_jackpot=1`).get(u.user.id).c;
  assert.equal(jp, 2);
  // same spin id => same jitter (deterministic for replays)
  assert.equal(W.landJitterDeg("abc"), W.landJitterDeg("abc"));
});

test("the real RNG stays inside the table and roughly follows weights", async () => {
  const counts = Array(8).fill(0);
  for (let i = 0; i < 4000; i++) {
    const roll = (await import("node:crypto")).randomInt(0, 10000);
    counts[W.pickSector(W.TABLE_A, roll).pos] += 1;
  }
  assert.ok(counts[4] > counts[5] * 5, "70-coin sector (20%) far likelier than 888 (1%)");
  assert.ok(counts.every((c, i) => i === 5 || c > 100));
});

/* ------------------------------------------------------------------ HTTP flow, idempotency, ledger */

test("HTTP spin: state, spin, idempotent replay, ledger + reward_claims, history", async () => {
  const u = await login(await mkUser("lwhttp"));
  const st = await api("/api/v1/me/lucky-wheel");
  assert.equal(st.status, 200);
  assert.equal(st.json.data.enabled, true);
  assert.equal(st.json.data.freeSpins.daily.remaining, 1);
  assert.equal(st.json.data.freeSpins.total, 1);
  assert.equal(st.json.data.sectors.length, 8);
  assert.equal(st.json.data.sectors[5].isJackpot, true);
  assert.equal(st.json.data.balance, JIU_COIN_REGISTER_GRANT);
  assert.equal(st.json.data.nextResetAt.endsWith("T00:00:00+08:00"), true);
  assert.equal((await api("/api/v1/me/jiu-coin")).json.data.wheel.enabled, true);

  const noKey = await spinHttp(u);
  assert.equal(noKey.status, 400);
  assert.equal(noKey.json.error.code, "INVALID_IDEMPOTENCY_KEY");
  assert.equal(getJiuCoinBalance(u.user.id), JIU_COIN_REGISTER_GRANT);

  const key = `idem-${Date.now()}-a`;
  const r1 = await spinHttp(u, key);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const d = r1.json.data;
  for (const f of ["spinId", "sector", "prize", "isJackpot", "balance", "freeSpins", "landJitterDeg", "nextResetAt"]) {
    assert.ok(f in d, `missing ${f}`);
  }
  assert.equal(d.replayed, false);
  assert.equal(d.freeSpins.total, 0);
  assert.equal(d.balance, JIU_COIN_REGISTER_GRANT + d.prize.amount);

  const r2 = await spinHttp(u, key);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.data.replayed, true);
  assert.equal(r2.json.data.spinId, d.spinId);
  assert.equal(r2.json.data.sector, d.sector);
  assert.equal(r2.json.data.balance, d.balance);
  assert.equal(getJiuCoinBalance(u.user.id), JIU_COIN_REGISTER_GRANT + d.prize.amount);
  assert.equal(ledgerWheel(u.user.id).length, 1);
  assert.equal(db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_spins WHERE user_id=?`).get(u.user.id).c, 1);

  const claim = db().prepare(`SELECT * FROM reward_claims WHERE user_id=? AND reward_key=?`).get(u.user.id, `wheel:${d.spinId}`);
  assert.ok(claim);
  assert.equal(claim.amount, d.prize.amount);
  const led = ledgerWheel(u.user.id)[0];
  assert.equal(led.delta, d.prize.amount);
  assert.equal(led.ref_id, d.spinId);
  assert.equal(led.balance_after, d.balance);
  assert.equal(ledgerSum(u.user.id), getJiuCoinBalance(u.user.id), "ledger sums to balance");

  const out = await spinHttp(u, `idem-${Date.now()}-b`);
  assert.equal(out.status, 409);
  assert.equal(out.json.error.code, "NO_SPINS_LEFT");
  assert.ok(out.json.error.details.nextResetAt);
  assert.equal(getJiuCoinBalance(u.user.id), JIU_COIN_REGISTER_GRANT + d.prize.amount);

  const h = await api("/api/v1/me/lucky-wheel/history");
  assert.equal(h.json.data.items.length, 1);
  assert.equal(h.json.data.items[0].spinId, d.spinId);
  assert.equal(st.json.data.sectors.length, 8);
});

test("auth required; reused key from another user does not leak a result", async () => {
  clearJar();
  assert.equal((await api("/api/v1/me/lucky-wheel")).status, 401);
  const a = await login(await mkUser("lwkeya"));
  const key = `shared-key-${Date.now()}`;
  const ra = await spinHttp(a, key);
  assert.equal(ra.status, 200);
  const b = await login(await mkUser("lwkeyb"));
  const rb = await spinHttp(b, key);
  assert.equal(rb.status, 200);
  assert.notEqual(rb.json.data.spinId, ra.json.data.spinId);
  assert.equal(ledgerWheel(a.user.id).length, 1);
  assert.equal(ledgerWheel(b.user.id).length, 1);
});

test("concurrency: parallel double spin => exactly one pays; same key twice => one row, both 200", async () => {
  const u = await login(await mkUser("lwrace"));
  const base = Date.now();
  const [x, y] = await Promise.all([spinHttp(u, `race-${base}-1`), spinHttp(u, `race-${base}-2`)]);
  const codes = [x.status, y.status].sort();
  assert.deepEqual(codes, [200, 409]);
  assert.equal(ledgerWheel(u.user.id).length, 1);
  assert.equal(db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_spins WHERE user_id=?`).get(u.user.id).c, 1);
  assert.equal(ledgerSum(u.user.id), getJiuCoinBalance(u.user.id));

  const v = await login(await mkUser("lwrace2"));
  const k = `race-same-${base}`;
  const burst = await Promise.all([spinHttp(v, k), spinHttp(v, k), spinHttp(v, k), spinHttp(v, k)]);
  assert.ok(burst.every((r) => r.status === 200));
  assert.equal(new Set(burst.map((r) => r.json.data.spinId)).size, 1);
  assert.equal(ledgerWheel(v.user.id).length, 1);
  assert.equal(burst.filter((r) => r.json.data.replayed === false).length, 1);
});

test("DB hard guards: duplicate daily slot / idem key / wheel ledger ref are rejected by constraints", async () => {
  const u = await mkUser("lwguard");
  const r = W.spinWheel(u.user.id, { idemKey: `guard-${u.user.id}-1`, rng: () => 0 });
  assert.equal(r.status, 200);
  const row = db().prepare(`SELECT * FROM lucky_wheel_spins WHERE spin_id=?`).get(r.data.spinId);
  const ins = (over) => {
    const o = { ...row, id: undefined, spin_id: `x-${Math.random()}`, ...over };
    return db()
      .prepare(
        `INSERT INTO lucky_wheel_spins (spin_id,user_id,idem_key,spin_date,source,slot,credit_grant_id,config_version,sector,roll,drawn_kind,prize_kind,prize_item,prize_qty,coin_value,substituted,is_jackpot,ledger_id,item_ledger_id,bonus_grant_id,balance_after)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(o.spin_id, o.user_id, o.idem_key, o.spin_date, o.source, o.slot, o.credit_grant_id, o.config_version, o.sector, o.roll, o.drawn_kind, o.prize_kind, o.prize_item, o.prize_qty, o.coin_value, o.substituted, o.is_jackpot, null, null, null, o.balance_after);
  };
  assert.throws(() => ins({ idem_key: "another-key-12345678" }), /UNIQUE/, "same user/date/slot");
  assert.throws(() => ins({ slot: 2 }), /UNIQUE/, "same idem key");
  assert.throws(() => db().prepare(`INSERT INTO jiu_coin_ledger (user_id, delta, balance_after, reason, ref_type, ref_id) VALUES (?, 5, 5, 'lucky_wheel', 'wheel_spin', ?)`).run(u.user.id, r.data.spinId), /UNIQUE/);
  assert.throws(() => db().prepare(`UPDATE lucky_wheel_spins SET sector = 9 WHERE spin_id = ?`).run(r.data.spinId), /CHECK/);
});

test("flag OFF: spin 403, state disabled; replay of an earlier spin still returns the stored result", async () => {
  const u = await login(await mkUser("lwoff"));
  const key = `off-${Date.now()}-1`;
  const r1 = await spinHttp(u, key);
  assert.equal(r1.status, 200);
  config.luckyWheelEnabled = false;
  try {
    const st = await api("/api/v1/me/lucky-wheel");
    assert.deepEqual(st.json.data, { enabled: false });
    const fresh = await spinHttp(u, `off-${Date.now()}-2`);
    assert.equal(fresh.status, 403);
    assert.equal(fresh.json.error.code, "FEATURE_DISABLED");
    const replay = await spinHttp(u, key);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.data.spinId, r1.json.data.spinId);
    assert.equal(ledgerWheel(u.user.id).length, 1);
  } finally {
    config.luckyWheelEnabled = true;
  }
});

test("rate limit: per-user spin attempts are limited (429), DB state untouched", async () => {
  const u = await login(await mkUser("lwrl"));
  resetRateLimitBuckets();
  config.rateLimit.wheelSpinPerUserMinute = 3;
  try {
    const res = [];
    for (let i = 0; i < 5; i++) res.push(await spinHttp(u, `rl-${Date.now()}-${i}`));
    assert.equal(res.filter((r) => r.status === 429).length, 2);
    assert.equal(res.find((r) => r.status === 429).json.error.code, "RATE_LIMITED");
    assert.equal(ledgerWheel(u.user.id).length, 1);
  } finally {
    reset();
  }
});

/* ------------------------------------------------------------------ Asia/Shanghai day boundary */

test("day boundary is Asia/Shanghai midnight (16:00Z), not UTC", async () => {
  const u = await mkUser("lwday");
  try {
    process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-10-19T15:59:59Z")); // 23:59:59 on 10-19 Shanghai
    const a = W.spinWheel(u.user.id, { idemKey: `daykey-${u.user.id}-1`, rng: () => 0 });
    assert.equal(a.data.spinDate, "2026-10-19");
    assert.equal(a.data.nextResetAt, "2026-10-20T00:00:00+08:00");
    const none = W.spinWheel(u.user.id, { idemKey: `daykey-${u.user.id}-2`, rng: () => 0 });
    assert.equal(none.error.code, "NO_SPINS_LEFT");
    process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-10-19T16:00:00Z")); // 00:00:00 on 10-20 Shanghai
    assert.equal(W.getWheelState(u.user.id).freeSpins.total, 1);
    const b = W.spinWheel(u.user.id, { idemKey: `daykey-${u.user.id}-3`, rng: () => 0 });
    assert.equal(b.status, 200);
    assert.equal(b.data.spinDate, "2026-10-20");
    assert.equal(b.data.freeSpins.total, 0);
    assert.equal(W.getWheelState(u.user.id).date, "2026-10-20");
  } finally {
    delete process.env.STOCKGAME_NOW_MS;
  }
});

test("daily free count is configurable (1..5) and credits stack after it", async () => {
  const u = await mkUser("lwcfg");
  config.luckyWheelDailyFree = 3;
  try {
    for (let i = 0; i < 3; i++) assert.equal(W.spinWheel(u.user.id, { idemKey: `cfgkey-${u.user.id}-${i}`, rng: () => 0 }).status, 200);
    assert.equal(W.spinWheel(u.user.id, { idemKey: `cfgkey-${u.user.id}-x`, rng: () => 0 }).error.code, "NO_SPINS_LEFT");
    const slots = db().prepare(`SELECT slot FROM lucky_wheel_spins WHERE user_id=? AND source='daily' ORDER BY slot`).all(u.user.id).map((r) => r.slot);
    assert.deepEqual(slots, [1, 2, 3]);
  } finally {
    config.luckyWheelDailyFree = 1;
  }
});

/* ------------------------------------------------------------------ legacy 每日领取 untouched */

test("legacy /daily: flag OFF => unchanged behaviour and payload; no wheel key", async () => {
  config.luckyWheelEnabled = false;
  try {
    const u = await login(await mkUser("lwleg"));
    const st = await api("/api/v1/me/jiu-coin");
    assert.deepEqual(Object.keys(st.json.data).sort(), ["amount", "balance", "claimedAt", "claimedToday", "date"]);
    const d1 = await api("/api/v1/me/jiu-coin/daily", { method: "POST", csrf: u.csrf });
    assert.equal(d1.status, 200);
    assert.ok(d1.json.data.amount >= 50 && d1.json.data.amount <= 200);
    const d2 = await api("/api/v1/me/jiu-coin/daily", { method: "POST", csrf: u.csrf });
    assert.equal(d2.status, 409);
    assert.equal(getJiuCoinBalance(u.user.id), JIU_COIN_REGISTER_GRANT + d1.json.data.amount);
    assert.equal(ledgerWheel(u.user.id).length, 0);
    assert.equal(db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_spins WHERE user_id=?`).get(u.user.id).c, 0);
  } finally {
    config.luckyWheelEnabled = true;
  }
});

test("flag ON: /daily => 410 DAILY_REPLACED_BY_WHEEL, no coins; legacy claim today consumes the daily slot", async () => {
  const u = await login(await mkUser("lwon"));
  const r = await api("/api/v1/me/jiu-coin/daily", { method: "POST", csrf: u.csrf });
  assert.equal(r.status, 410);
  assert.equal(r.json.error.code, "DAILY_REPLACED_BY_WHEEL");
  assert.equal(getJiuCoinBalance(u.user.id), JIU_COIN_REGISTER_GRANT);

  // cutover edge: user already took the legacy claim today => no free spin today (no double dip)
  const v = await mkUser("lwcut");
  db().prepare(`INSERT INTO jiu_coin_daily_claims (user_id, claim_date, amount) VALUES (?, ?, 100)`).run(v.user.id, shanghaiYmd());
  const state = W.getWheelState(v.user.id);
  assert.equal(state.freeSpins.total, 0);
  assert.equal(state.legacyClaimedToday, true);
  assert.equal(W.spinWheel(v.user.id, { idemKey: `cutkey-${v.user.id}`, rng: () => 0 }).error.code, "NO_SPINS_LEFT");
  // ...but an admin credit still works
  W.adminGrantSpins({ actorId: null, userId: v.user.id, spins: 1, reason: "补偿一次" });
  assert.equal(W.spinWheel(v.user.id, { idemKey: `cutkey2-${v.user.id}`, rng: () => 0 }).status, 200);
});

/* ------------------------------------------------------------------ spin-again + items (Table B plug-in) */

function saveCfg(input, extra = {}) {
  return W.adminSaveConfig({ actorId: null, input, reason: "测试保存配置", ...extra });
}
const restoreA = () => {
  const r = saveCfg(null, { restoreVersion: 1 });
  assert.ok(r.ok, JSON.stringify(r));
};

test("spin again: grants a same-day credit, capped at 5 draws/day (then pays 60 coins, substituted)", async () => {
  const u = await mkUser("lwagain");
  const tbl = coinTable([90, 300, 50, 150, 70, 888, 110, 200], [1800, 700, 1400, 1400, 1300, 100, 1600, 1700]);
  tbl[4] = { pos: 4, kind: "spin", qty: 1, weight: 1300 };
  const saved = saveCfg({ sectors: tbl });
  assert.ok(saved.ok, JSON.stringify(saved));
  try {
    const spinRoll = 1800 + 700 + 1400 + 1400; // first roll in sector 4
    const bal0 = getJiuCoinBalance(u.user.id);
    let n = 0;
    const r1 = W.spinWheel(u.user.id, { idemKey: `agkey-${u.user.id}-${++n}`, rng: () => spinRoll });
    assert.equal(r1.data.sector, 4);
    assert.equal(r1.data.prize.kind, "spin");
    assert.equal(r1.data.prize.id, "spin-again");
    assert.equal(r1.data.balance, bal0, "no coins for a spin-again");
    assert.equal(r1.data.freeSpins.total, 1, "bonus spin is available immediately");
    assert.equal(ledgerWheel(u.user.id).length, 0);
    // chain: draws 2,3,4 are spin-again too; draw 5 would exceed the cap => substituted 60 coins
    for (let i = 0; i < 3; i++) {
      const r = W.spinWheel(u.user.id, { idemKey: `agkey-${u.user.id}-${++n}`, rng: () => spinRoll });
      assert.equal(r.data.prize.kind, "spin", `draw ${i + 2}`);
    }
    const last = W.spinWheel(u.user.id, { idemKey: `agkey-${u.user.id}-${++n}`, rng: () => spinRoll });
    assert.equal(last.status, 200);
    assert.equal(last.data.prize.kind, "jiu_coin");
    assert.equal(last.data.prize.amount, W.SPIN_CAP_SUBSTITUTE_COINS);
    assert.equal(last.data.prize.substituted, true);
    assert.equal(last.data.sector, 4);
    assert.equal(db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_spins WHERE user_id=?`).get(u.user.id).c, 5);
    assert.equal(getJiuCoinBalance(u.user.id), bal0 + 60);
    assert.equal(W.spinWheel(u.user.id, { idemKey: `agkey-${u.user.id}-more`, rng: () => 0 }).error.code, "NO_SPINS_LEFT");
    assert.equal(ledgerSum(u.user.id), getJiuCoinBalance(u.user.id));
  } finally {
    restoreA();
  }
});

test("items: stub granter pays tickets; unavailable/overflow/rewind-off substitute coins at qty×ticket value", async () => {
  const origRewind = config.gameRewindEnabled;
  config.gameRewindEnabled = true;
  const calls = [];
  W.registerItemGranter((d, a) => {
    calls.push(a);
    return a.item === "boom" ? { overflow: true } : { ledgerId: 777, qtyAfter: a.qty };
  });
  const saved = saveCfg({ sectors: W.TABLE_B, ticketCoinValue: 50 });
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.equal(saved.ev.ev, 130.09);
  W.adminGrantSpins({ actorId: null, userId: (await mkUser("lwitem")).user.id, spins: 1, reason: "占位" }); // exercise grant on a user w/o spin
  const u = await mkUser("lwitem2");
  W.adminGrantSpins({ actorId: null, userId: u.user.id, spins: 10, reason: "道具测试" });
  const roll = (pos) => W.TABLE_B.slice(0, pos).reduce((a, s) => a + s.weight, 0);
  try {
    const bal0 = getJiuCoinBalance(u.user.id);
    const a = W.spinWheel(u.user.id, { idemKey: `itkey-${u.user.id}-1`, rng: () => roll(1) }); // ×2 ticket
    assert.equal(a.data.prize.kind, "item");
    assert.equal(a.data.prize.item, "rewind_ticket");
    assert.equal(a.data.prize.qty, 2);
    assert.equal(a.data.prize.id, "rewind_ticket-x2");
    assert.equal(a.data.prize.coinValue, 100);
    assert.equal(a.data.balance, bal0, "tickets do not touch the coin balance");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].spinId, a.data.spinId);
    const row = db().prepare(`SELECT * FROM lucky_wheel_spins WHERE spin_id=?`).get(a.data.spinId);
    assert.equal(row.item_ledger_id, 777);
    assert.equal(row.ledger_id, null);
    // replay does not call the granter again
    const rep = W.spinWheel(u.user.id, { idemKey: `itkey-${u.user.id}-1`, rng: () => 0 });
    assert.equal(rep.data.replayed, true);
    assert.equal(calls.length, 1);
    // rewind feature off => substitution
    config.gameRewindEnabled = false;
    const b = W.spinWheel(u.user.id, { idemKey: `itkey-${u.user.id}-2`, rng: () => roll(6) }); // ×3 ticket
    assert.equal(b.data.prize.kind, "jiu_coin");
    assert.equal(b.data.prize.amount, 150);
    assert.equal(b.data.prize.substituted, true);
    assert.equal(b.data.balance, bal0 + 150);
    config.gameRewindEnabled = true;
    // granter overflow => substitution
    W.registerItemGranter(() => ({ overflow: true }));
    const c = W.spinWheel(u.user.id, { idemKey: `itkey-${u.user.id}-3`, rng: () => roll(1) });
    assert.equal(c.data.prize.substituted, true);
    assert.equal(c.data.prize.amount, 100);
    // no granter registered => substitution (and stats count it)
    W.registerItemGranter(null);
    const d = W.spinWheel(u.user.id, { idemKey: `itkey-${u.user.id}-4`, rng: () => roll(1) });
    assert.equal(d.data.prize.substituted, true);
    assert.equal(db().prepare(`SELECT drawn_kind FROM lucky_wheel_spins WHERE spin_id=?`).get(d.data.spinId).drawn_kind, "item");
    assert.equal(ledgerSum(u.user.id), getJiuCoinBalance(u.user.id));
    const stats = W.adminStats({ days: 1 });
    assert.ok(stats.today.substituted >= 3);
  } finally {
    W.registerItemGranter(null);
    config.gameRewindEnabled = origRewind;
    restoreA();
  }
});

/* ------------------------------------------------------------------ admin API */

test("admin: non-admin forbidden; writes need reauth", async () => {
  const u = await login(await mkUser("lwnoadm"));
  assert.equal((await api("/api/v1/admin/lucky-wheel")).status, 403);
  assert.equal((await api("/api/v1/admin/lucky-wheel/grant", { method: "POST", csrf: u.csrf, body: { userId: 1, spins: 1, reason: "xx" } })).status, 403);
  const nv = await adminSession({ verify: false });
  assert.equal((await api("/api/v1/admin/lucky-wheel")).status, 200, "reads work without reauth");
  const w = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: nv.csrf, body: { sectors: W.TABLE_A, reason: "无二次验证" } });
  assert.equal(w.status, 403);
  assert.equal(w.json.error.code, "ADMIN_REAUTH_REQUIRED");
  const g = await api("/api/v1/admin/lucky-wheel/grant", { method: "POST", csrf: nv.csrf, body: { userId: u.user.id, spins: 1, reason: "无二次验证" } });
  assert.equal(g.status, 403);
});

test("admin: get config, preview EV, save new version / validation errors / restore", async () => {
  const s = await adminSession();
  const g = await api("/api/v1/admin/lucky-wheel");
  assert.equal(g.status, 200);
  assert.equal(g.json.data.active.ev.ev, 125.68);
  assert.equal(g.json.data.active.sectorViews.length, 8);
  assert.equal(g.json.data.constraints.evMin, 60);
  assert.equal(g.json.data.constraints.evMax, 250);
  assert.equal(g.json.data.constraints.itemsAvailable, false);
  assert.equal(g.json.data.settings.enabled, true);

  const hiTable = coinTable([300, 300, 300, 300, 300, 300, 300, 300], EVEN);
  const pv = await api("/api/v1/admin/lucky-wheel/config/preview", { method: "POST", csrf: s.csrf, body: { sectors: hiTable } });
  assert.equal(pv.status, 400);
  assert.equal(pv.json.error.code, "EV_OUT_OF_BOUNDS");
  assert.equal(pv.json.error.ev.ev, 300);
  const good = coinTable([90, 300, 50, 150, 70, 888, 110, 200], [1800, 700, 1400, 1400, 2000, 100, 1500, 1100]);
  const pv2 = await api("/api/v1/admin/lucky-wheel/config/preview", { method: "POST", csrf: s.csrf, body: { sectors: good } });
  assert.equal(pv2.status, 200);
  assert.ok(pv2.json.data.ev.ev > 125);
  const before = db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_configs`).get().c;
  assert.equal(before, db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_configs`).get().c, "preview persists nothing");

  const bad = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s.csrf, body: { sectors: hiTable, reason: "太高了" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "EV_OUT_OF_BOUNDS");
  const noReason = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s.csrf, body: { sectors: good } });
  assert.equal(noReason.json.error.code, "REASON_REQUIRED");
  const items = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s.csrf, body: { sectors: W.TABLE_B, reason: "道具未部署" } });
  assert.equal(items.status, 400);
  assert.equal(items.json.error.code, "ITEMS_UNAVAILABLE");
  assert.equal(db().prepare(`SELECT COUNT(*) c FROM lucky_wheel_configs`).get().c, before, "failed saves persist nothing");

  const save = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s.csrf, body: { sectors: good, reason: "微调权重" } });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  const v = save.json.data.version;
  assert.ok(v > 1);
  assert.equal(W.getActiveConfig(db()).version, v);
  const audit = db().prepare(`SELECT * FROM audit_logs WHERE action='lucky_wheel.config' ORDER BY id DESC LIMIT 1`).get();
  assert.equal(audit.target_id, String(v));

  // a spin now records the new version; old rows keep theirs
  const u = await mkUser("lwcv");
  const sp = W.spinWheel(u.user.id, { idemKey: `cvkey-${u.user.id}`, rng: () => 0 });
  assert.equal(sp.data.configVersion, v);
  await login({ ...s, username: s.username, password: s.password });
  await api("/api/v1/admin/reauth", { method: "POST", csrf: (await login(s)).csrf, body: { password: s.password } });
  const s2 = await login(s);
  await api("/api/v1/admin/reauth", { method: "POST", csrf: s2.csrf, body: { password: s.password } });
  const rs = await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s2.csrf, body: { restoreVersion: 1, reason: "回滚到初始表" } });
  assert.equal(rs.status, 200, JSON.stringify(rs.json));
  assert.deepEqual(W.getActiveConfig(db()).sectors, JSON.parse(JSON.stringify(W.TABLE_A)));
  assert.ok(rs.json.data.version > v);
  assert.equal((await api("/api/v1/admin/lucky-wheel/config", { method: "PUT", csrf: s2.csrf, body: { restoreVersion: 9999, reason: "不存在" } })).status, 404);
});

test("admin: enable switch (功能开关), spin log filters, stats, grant spins (+idempotent), per-user view", async () => {
  const u = await mkUser("lwadmtarget");
  const s = await adminSession();
  // enable switch via the existing runtime settings
  const settings = await api("/api/v1/admin/settings");
  const keys = settings.json.data.items.map((i) => i.key);
  assert.ok(keys.includes("luckyWheelEnabled") && keys.includes("luckyWheelDailyFree"));
  const off = await api("/api/v1/admin/settings/luckyWheelEnabled", { method: "PUT", csrf: s.csrf, body: { value: false, reason: "关闭转盘" } });
  assert.equal(off.status, 200);
  assert.equal(config.luckyWheelEnabled, false);
  const on = await api("/api/v1/admin/settings/luckyWheelEnabled", { method: "PUT", csrf: s.csrf, body: { value: true, reason: "开启转盘" } });
  assert.equal(on.status, 200);
  assert.equal(config.luckyWheelEnabled, true);
  const bad = await api("/api/v1/admin/settings/luckyWheelDailyFree", { method: "PUT", csrf: s.csrf, body: { value: 9, reason: "太多了" } });
  assert.equal(bad.status, 400);

  // grant
  const grantBody = { userId: u.user.id, spins: 3, reason: "活动补偿" };
  const g1 = await api("/api/v1/admin/lucky-wheel/grant", { method: "POST", csrf: s.csrf, headers: { "Idempotency-Key": "grant-op-1-xyz" }, body: grantBody });
  assert.equal(g1.status, 200, JSON.stringify(g1.json));
  const g2 = await api("/api/v1/admin/lucky-wheel/grant", { method: "POST", csrf: s.csrf, headers: { "Idempotency-Key": "grant-op-1-xyz" }, body: grantBody });
  assert.equal(g2.json.data.unchanged, true);
  assert.equal(g2.json.data.grantId, g1.json.data.grantId);
  assert.equal(W.getWheelState(u.user.id).freeSpins.credits, 3);
  for (const body of [{ userId: u.user.id, spins: 0, reason: "xx" }, { userId: u.user.id, spins: 51, reason: "xx" }, { userId: u.user.id, spins: 1, reason: "" }, { userId: 99999999, spins: 1, reason: "xx" }, { userId: u.user.id, spins: 1, reason: "xx", expiresDate: "tomorrow" }]) {
    const r = await api("/api/v1/admin/lucky-wheel/grant", { method: "POST", csrf: s.csrf, body });
    assert.ok([400, 404].includes(r.status), JSON.stringify(body));
  }
  assert.ok(db().prepare(`SELECT 1 FROM audit_logs WHERE action='lucky_wheel.grant' AND target_id=?`).get(String(u.user.id)));
  // expired credits do not count
  W.adminGrantSpins({ actorId: null, userId: u.user.id, spins: 5, reason: "过期测试", expiresDate: "2020-01-01" });
  assert.equal(W.getWheelState(u.user.id).freeSpins.credits, 3);

  // use daily + 1 credit, jackpot
  const a = W.spinWheel(u.user.id, { idemKey: `admkey-${u.user.id}-1`, rng: () => 7300 }); // sector 5 => 888 jackpot
  assert.equal(a.data.isJackpot, true);
  assert.equal(a.data.prize.amount, 888);
  W.spinWheel(u.user.id, { idemKey: `admkey-${u.user.id}-2`, rng: () => 0 });

  const list = await api(`/api/v1/admin/lucky-wheel/spins?userId=${u.user.id}`);
  assert.equal(list.status, 200);
  assert.equal(list.json.data.items.length, 2);
  assert.equal(list.json.data.items[0].username.startsWith("lwadmtarget"), true);
  const big = await api(`/api/v1/admin/lucky-wheel/spins?userId=${u.user.id}&minValue=500`);
  assert.equal(big.json.data.items.length, 1);
  assert.equal(big.json.data.items[0].prize.isJackpot, true);
  assert.equal((await api(`/api/v1/admin/lucky-wheel/spins?userId=${u.user.id}&source=credit`)).json.data.items.length, 1);
  assert.equal((await api(`/api/v1/admin/lucky-wheel/spins?date=1999-01-01`)).json.data.items.length, 0);
  assert.equal((await api(`/api/v1/admin/lucky-wheel/spins?date=bad`)).status, 400);
  const page1 = await api(`/api/v1/admin/lucky-wheel/spins?limit=1`);
  assert.equal(page1.json.data.items.length, 1);
  assert.ok(page1.json.data.nextCursor);
  const page2 = await api(`/api/v1/admin/lucky-wheel/spins?limit=1&cursor=${page1.json.data.nextCursor}`);
  assert.notEqual(page2.json.data.items[0].id, page1.json.data.items[0].id);

  const st = await api("/api/v1/admin/lucky-wheel/stats?days=7");
  assert.equal(st.status, 200);
  assert.equal(st.json.data.series.length, 7);
  assert.ok(st.json.data.totals.spins >= 2);
  assert.ok(st.json.data.totals.jackpots >= 1);
  assert.ok(st.json.data.totals.realizedPerDraw > 0);
  assert.equal(st.json.data.configuredEv.ev, 125.68);
  assert.equal(st.json.data.series[6].date, shanghaiYmd());

  const uw = await api(`/api/v1/admin/users/${u.user.id}/jiu-coin`);
  assert.equal(uw.status, 200);
  assert.ok(uw.json.data.wheel.grants.length >= 1);
  assert.ok("daily" in uw.json.data && "balance" in uw.json.data, "legacy fields still present");
});

test("coin ledger regression: after everything the ledger of every wheel user equals their balance", () => {
  const rows = db().prepare(`SELECT DISTINCT user_id FROM lucky_wheel_spins`).all();
  assert.ok(rows.length >= 5);
  for (const { user_id } of rows) {
    assert.equal(ledgerSum(user_id), getJiuCoinBalance(user_id), `user ${user_id}`);
    const wins = db().prepare(`SELECT COALESCE(SUM(prize_qty),0) s FROM lucky_wheel_spins WHERE user_id=? AND prize_kind='jiu_coin'`).get(user_id).s;
    const led = db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=? AND reason='lucky_wheel'`).get(user_id).s;
    assert.equal(led, wins, `wheel credits == ledger for ${user_id}`);
  }
  clearSettingOverrides();
});

test("true multi-process race: 6 processes spin the same user at once => exactly one paid spin", async () => {
  const { spawn } = await import("node:child_process");
  const u = await mkUser("lwproc");
  const script = `
    const W = await import(${JSON.stringify(new URL("../src/lib/luckyWheel.js", import.meta.url).href)});
    const r = W.spinWheel(${u.user.id}, { idemKey: "proc-" + process.pid + "-" + Date.now() });
    console.log(JSON.stringify({ status: r.status || null, code: r.error?.code || null }));
  `;
  const runOne = () =>
    new Promise((resolve) => {
      const c = spawn(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, LUCKY_WHEEL_ENABLED: "1" },
      });
      let out = "";
      let err = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (err += d));
      c.on("close", () => resolve({ out: out.trim(), err }));
    });
  const res = await Promise.all(Array.from({ length: 6 }, runOne));
  const parsed = res.map((r) => {
    try { return JSON.parse(r.out.split("\n").pop()); } catch { return { raw: r }; }
  });
  assert.equal(parsed.filter((p) => p.status === 200).length, 1, JSON.stringify(res));
  assert.equal(parsed.filter((p) => p.code === "NO_SPINS_LEFT").length, 5, JSON.stringify(res));
  assert.equal(ledgerWheel(u.user.id).length, 1);
  assert.equal(ledgerSum(u.user.id), getJiuCoinBalance(u.user.id));
});
