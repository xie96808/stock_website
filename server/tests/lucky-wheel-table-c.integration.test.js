/** Table C (Bill 2026-10-19) + wheel ⇄ inventory wiring (W2 acceptance on Table C). */
import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";
process.env.EVENT_PROTOCOL_ENABLED = "1";
delete process.env.STOCKGAME_NOW_MS;

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");
const W = await import("../src/lib/luckyWheel.js");
const I = await import("../src/lib/userItems.js");
const { wheelItemGranter } = await import("../src/lib/wheelItems.js");
const { api, register, stop, jar } = await startTestServer();
test.after(async () => stop());

const db = () => openDb();
let seq = 0;
const uniq = (p) => `${p}${Date.now().toString(36)}${++seq}`;
config.luckyWheelEnabled = true;
resetRateLimitBuckets();
config.rateLimit.wheelSpinPerUserMinute = 10_000;
config.rateLimit.wheelSpinPerIpMinute = 10_000;

const rollFor = (table, pos) => table.slice(0, pos).reduce((a, s) => a + s.weight, 0);
const save = (sectors, reason = "测试表C") => W.adminSaveConfig({ actorId: null, input: { sectors, ticketCoinValue: 50 }, reason });
const restoreA = () => assert.ok(W.adminSaveConfig({ actorId: null, input: null, restoreVersion: 1, reason: "恢复表A" }).ok);
const tickets = (uid) => I.getItemQty(db(), uid, "rewind_ticket");
const ledgerSum = (uid) => db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=?`).get(uid).s;
async function userWithSpins(prefix, spins) {
  const u = await register(uniq(prefix));
  if (spins) W.adminGrantSpins({ actorId: null, userId: u.user.id, spins, reason: "表C测试次数" });
  return u;
}

test("Table C presets: exact values/order, weights 10000, jackpot 888 at gold pos 5 (1%), EV within 125–135 and ≤250", () => {
  for (const [name, t] of [["C1", W.TABLE_C1], ["C2", W.TABLE_C2]]) {
    assert.equal(t.length, 8);
    assert.equal(t.reduce((a, s) => a + s.weight, 0), 10000, name);
    assert.deepEqual(t.map((s) => W.prizeId(s)), ["coin-58", "rewind_ticket-x2", "coin-150", "spin-again", "coin-200", "coin-888", "rewind_ticket-x3", "coin-300"]);
    assert.equal(t[5].jackpot, true);
    assert.equal(t[5].weight, 100);
    assert.equal(t.filter((s) => s.jackpot).length, 1);
    const ev = W.computeEv(t, 50);
    assert.ok(ev.ev >= 125 && ev.ev <= 135, `${name} ev ${ev.ev}`);
    assert.ok(ev.ev <= W.EV_MAX);
    // alternating coin / non-coin where possible: no two non-coin sectors adjacent
    for (let i = 0; i < 8; i++) assert.ok(!(t[i].kind !== "jiu_coin" && t[(i + 1) % 8].kind !== "jiu_coin"), `${name} pos ${i}`);
  }
  assert.equal(W.computeEv(W.TABLE_C1, 50).ev, 130.29);
  assert.equal(W.computeEv(W.TABLE_C2, 50).ev, 133.07);
  assert.equal(W.spinCapCoins(W.TABLE_C1), 58);
  assert.equal(W.TABLE_C, W.TABLE_C1);
});

test("granter is registered at boot: item sectors save; config not auto-activated by migrations", async () => {
  assert.equal(W.itemsAvailable(), true);
  assert.equal(W.getActiveConfig(db()).version, 1, "Table A stays active until an explicit save");
  const v = W.validateWheelConfig({ sectors: W.TABLE_C1 });
  assert.ok(v.ok, JSON.stringify(v));
  const off = W.validateWheelConfig({ sectors: W.TABLE_C1 }, { rewindEnabled: false });
  assert.equal(off.code, "REWIND_DISABLED");
});

test("all 8 Table C landings exact; ticket → inventory + /me/items agrees; spin-again re-arms; balances reconcile", async () => {
  const saved = save(W.TABLE_C1);
  assert.ok(saved.ok, JSON.stringify(saved));
  const oldCap = config.rewindTicketDailyCap;
  config.rewindTicketDailyCap = 5; // ×2 + ×3 on one day (the default cap 4 is tested separately)
  try {
    const u = await userWithSpins("tc", 20);
    const uid = u.user.id;
    const bal0 = getJiuCoinBalance(uid);
    let coins = 0;
    let t = 0;
    for (let pos = 0; pos < 8; pos++) {
      const r = W.spinWheel(uid, { idemKey: `idemkey-tc-${uid}-${pos}`, rng: () => rollFor(W.TABLE_C1, pos) });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.data.sector, pos, `landing ${pos}`);
      const s = W.TABLE_C1[pos];
      if (s.kind === "jiu_coin") {
        assert.equal(r.data.prize.kind, "jiu_coin");
        assert.equal(r.data.prize.amount, s.amount);
        assert.equal(r.data.isJackpot, !!s.jackpot);
        coins += s.amount;
      } else if (s.kind === "item") {
        assert.equal(r.data.prize.kind, "item");
        assert.equal(r.data.prize.qty, s.qty);
        assert.equal(r.data.prize.substituted, false);
        t += s.qty;
        const row = db().prepare(`SELECT * FROM lucky_wheel_spins WHERE spin_id=?`).get(r.data.spinId);
        const led = db().prepare(`SELECT * FROM user_item_ledger WHERE id=?`).get(row.item_ledger_id);
        assert.equal(led.reason, "wheel_prize");
        assert.equal(led.ref_id, r.data.spinId);
        assert.equal(led.delta, s.qty);
      } else {
        assert.equal(r.data.prize.kind, "spin");
        assert.ok(r.data.freeSpins.credits >= 1);
      }
      assert.equal(getJiuCoinBalance(uid), bal0 + coins);
      assert.equal(tickets(uid), t);
    }
    assert.equal(t, 5);
    const me = await api("/api/v1/me/items");
    assert.equal(me.json.data.rewindTickets, 5);
    const st = await api("/api/v1/me/lucky-wheel");
    assert.deepEqual(st.json.data.sectors.map((s) => s.art), ["coin-t1", "ticket-x2", "coin-t3", "spin-again", "coin-t4", "coin-t5", "ticket-x3", "coin-t4"]);
    assert.equal(ledgerSum(uid), getJiuCoinBalance(uid));
    assert.deepEqual(I.reconcileItems(db()), []);
  } finally {
    config.rewindTicketDailyCap = oldCap;
    restoreA();
  }
});

test("supply caps: daily ticket cap 4 and hold cap 30 substitute coins (qty×50, substituteReason); admin grants ignore caps", async () => {
  assert.ok(save(W.TABLE_C1).ok);
  try {
    const u = await userWithSpins("cap", 20);
    const uid = u.user.id;
    const x3 = rollFor(W.TABLE_C1, 6);
    const x2 = rollFor(W.TABLE_C1, 1);
    const a = W.spinWheel(uid, { idemKey: `idemkey-cap-${uid}-1`, rng: () => x3 });
    assert.equal(a.data.prize.kind, "item"); // 3 won today
    const b = W.spinWheel(uid, { idemKey: `idemkey-cap-${uid}-2`, rng: () => x2 }); // 3+2 > 4
    assert.equal(b.data.prize.kind, "jiu_coin");
    assert.equal(b.data.prize.amount, 100);
    assert.equal(b.data.prize.substituted, true);
    assert.equal(b.data.prize.substituteReason, "ticket_daily_cap");
    assert.equal(b.data.prize.drawnKind, "item");
    assert.equal(b.data.sector, 1, "still lands on the drawn sector");
    assert.equal(tickets(uid), 3);
    const rep = W.spinWheel(uid, { idemKey: `idemkey-cap-${uid}-2`, rng: () => 0 });
    assert.equal(rep.data.replayed, true);
    assert.equal(rep.data.prize.substituteReason, "ticket_daily_cap");

    const h = await userWithSpins("hold", 5);
    const adj = I.adminAdjustItems({ actorId: null, userId: h.user.id, delta: 29, reason: "测试持有上限" });
    assert.ok(adj.ok, JSON.stringify(adj));
    const c = W.spinWheel(h.user.id, { idemKey: `idemkey-hold-${h.user.id}-1`, rng: () => x2 }); // 29+2 > 30
    assert.equal(c.data.prize.substituteReason, "ticket_hold_cap");
    assert.equal(c.data.prize.amount, 100);
    assert.equal(tickets(h.user.id), 29);
    const more = I.adminAdjustItems({ actorId: null, userId: h.user.id, delta: 11, reason: "管理员不受上限" });
    assert.ok(more.ok);
    assert.equal(tickets(h.user.id), 40);

    config.gameRewindEnabled = false;
    try {
      const d = W.spinWheel(h.user.id, { idemKey: `idemkey-hold-${h.user.id}-2`, rng: () => x3 });
      assert.equal(d.data.prize.substituteReason, "rewind_disabled");
      assert.equal(d.data.prize.amount, 150);
    } finally {
      config.gameRewindEnabled = true;
    }
    assert.deepEqual(I.reconcileItems(db()), []);
  } finally {
    restoreA();
  }
});

test("再转一次 cap: 5 draws/day, the 5th 再转一次 pays the minimum 58 (spin_cap)", async () => {
  assert.ok(save(W.TABLE_C1).ok);
  try {
    const u = await register(uniq("sc"));
    const uid = u.user.id;
    const spin = rollFor(W.TABLE_C1, 3);
    const bal0 = getJiuCoinBalance(uid);
    for (let i = 1; i <= 4; i++) {
      const r = W.spinWheel(uid, { idemKey: `idemkey-sc-${uid}-${i}`, rng: () => spin });
      assert.equal(r.data.prize.kind, "spin", `draw ${i}`);
      assert.equal(r.data.freeSpins.total, 1);
    }
    const last = W.spinWheel(uid, { idemKey: `idemkey-sc-${uid}-5`, rng: () => spin });
    assert.equal(last.data.prize.kind, "jiu_coin");
    assert.equal(last.data.prize.amount, 58);
    assert.equal(last.data.prize.substituteReason, "spin_cap");
    assert.equal(last.data.sector, 3);
    assert.equal(getJiuCoinBalance(uid), bal0 + 58);
    assert.equal(W.spinWheel(uid, { idemKey: `idemkey-sc-${uid}-6`, rng: () => 0 }).error.code, "NO_SPINS_LEFT");
  } finally {
    restoreA();
  }
});

test("exhaustive roll map: every roll 0..9999 maps to its sector, frequencies == weights, EV matches", () => {
  for (const t of [W.TABLE_C1, W.TABLE_C2]) {
    const counts = new Array(8).fill(0);
    let value = 0;
    let spins = 0;
    for (let roll = 0; roll < 10000; roll++) {
      const s = W.pickSector(t, roll);
      counts[s.pos] += 1;
      if (s.kind === "spin") spins += 1;
      else value += s.kind === "jiu_coin" ? s.amount : s.qty * 50;
    }
    assert.deepEqual(counts, t.map((s) => s.weight));
    const ev = Math.round((value / 10000 / (1 - spins / 10000)) * 100) / 100;
    assert.equal(ev, W.computeEv(t, 50).ev);
  }
});

test("2000 seeded spins on Table C1: realized per-draw value within 3% of configured; ledgers reconcile", async () => {
  assert.ok(save(W.TABLE_C1).ok);
  const oldCap = config.rewindTicketDailyCap;
  config.rewindTicketDailyCap = 20;
  try {
    let x = 0x9e3779b9;
    const rng = (m) => {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      return x % m;
    };
    let total = 0;
    let n = 0;
    const users = [];
    for (let k = 0; k < 400; k++) {
      const u = await register(uniq("sim"));
      users.push(u.user.id);
      W.adminGrantSpins({ actorId: null, userId: u.user.id, spins: 4, reason: "模拟" });
      for (let i = 0; i < 6; i++) {
        const r = W.spinWheel(u.user.id, { idemKey: `idemkey-sim-${u.user.id}-${i}`, rng });
        if (r.error) break;
        total += r.data.prize.coinValue;
        n += 1;
      }
    }
    assert.ok(n >= 2000, `n=${n}`);
    const realized = total / n;
    const cfg = W.computeEv(W.TABLE_C1, 50).perDraw;
    assert.ok(Math.abs(realized - cfg) / cfg < 0.03, `realized ${realized} vs ${cfg}`);
    for (const uid of users.slice(0, 50)) assert.equal(ledgerSum(uid), getJiuCoinBalance(uid));
    assert.deepEqual(I.reconcileItems(db()), []);
  } finally {
    config.rewindTicketDailyCap = oldCap;
    restoreA();
  }
});

test("end-to-end: ticket won on the wheel pays a real classic-game rewind; game stays clean; coins untouched", async () => {
  assert.ok(save(W.TABLE_C1).ok);
  try {
    const u = await register(uniq("e2e"));
    const uid = u.user.id;
    const r = W.spinWheel(uid, { idemKey: `idemkey-e2e-${uid}`, rng: () => rollFor(W.TABLE_C1, 1) });
    assert.equal(r.data.prize.kind, "item");
    assert.equal(tickets(uid), 2);
    const create = await api("/api/v1/games", { method: "POST", csrf: u.csrfToken, headers: { "Idempotency-Key": `e2e-create-${uid}` }, body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } } });
    assert.equal(create.status, 201, JSON.stringify(create.json));
    const gid = create.json.data.gameId;
    const dec = await api(`/api/v1/games/${gid}/decisions`, { method: "POST", csrf: u.csrfToken, headers: { "Idempotency-Key": `e2e-dec-${uid}` }, body: { expectedRevision: 0, action: "buy" } });
    assert.equal(dec.status, 200);
    const bal = getJiuCoinBalance(uid);
    const rw = await api(`/api/v1/games/${gid}/rewind`, { method: "POST", csrf: u.csrfToken, headers: { "Idempotency-Key": `e2e-rw-${uid}` }, body: { expectedRevision: 1, payWith: "ticket" } });
    assert.equal(rw.status, 200, JSON.stringify(rw.json));
    assert.equal(rw.json.data.assistClass, "clean");
    assert.equal(rw.json.data.ticketsLeft, 1);
    assert.equal(getJiuCoinBalance(uid), bal);
    assert.equal(tickets(uid), 1);
    assert.equal(ledgerSum(uid), getJiuCoinBalance(uid));
  } finally {
    restoreA();
  }
});

test("granter direct: hold cap from settings", () => {
  const before = config.rewindTicketHoldCap;
  config.rewindTicketHoldCap = 1;
  try {
    const uid = db().prepare(`SELECT id FROM users WHERE is_bot = 0 ORDER BY id DESC LIMIT 1`).get().id;
    const r = wheelItemGranter(db(), { userId: uid, item: "rewind_ticket", qty: 2, spinId: "direct-1" });
    assert.equal(r.overflow, true);
    assert.equal(r.reason, "ticket_hold_cap");
  } finally {
    config.rewindTicketHoldCap = before;
  }
  void jar;
});
