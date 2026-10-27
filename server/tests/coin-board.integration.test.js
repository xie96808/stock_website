import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.COIN_BOARD_ENABLED = "1";
process.env.COIN_BOARD_CACHE_TTL_MS = "0";

const { openDb } = await import("../src/db/connection.js");
const { insertJiuCoinLedger } = await import("../src/lib/jiuCoin.js");
const { weekStartUtc } = await import("../src/lib/coinBoard.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;
const optIn = (...ids) => ids.forEach((id) => openDb().prepare(`UPDATE users SET leaderboard_opt_in = 1 WHERE id = ?`).run(id));
async function as(u) {
  for (const k of Object.keys(jar)) delete jar[k];
  const r = await api("/api/v1/auth/login", { method: "POST", body: { username: u.username, password: u.password } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
test.after(async () => {
  await stop();
});

const setBal = (id, n) => openDb().prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`).run(n, id);
function ledger(userId, delta, reason, createdAt) {
  const db = openDb();
  insertJiuCoinLedger(db, { userId, delta, balanceAfter: 0, reason, refType: "t", refId: `${reason}-${Math.random()}` });
  if (createdAt) db.prepare(`UPDATE jiu_coin_ledger SET created_at = ? WHERE id = (SELECT MAX(id) FROM jiu_coin_ledger)`).run(createdAt);
}

test("weekStartUtc: Monday 00:00 Shanghai, DST-free", () => {
  // Wed 2026-10-28 12:00 Shanghai → Mon 2026-10-26 00:00 Shanghai = Sun 16:00 UTC
  assert.equal(weekStartUtc(Date.UTC(2026, 9, 28, 4, 0, 0)), "2026-10-25 16:00:00");
  // Sunday 23:59 Shanghai still belongs to the week that started the Monday before
  assert.equal(weekStartUtc(Date.UTC(2026, 9, 25, 15, 59, 0)), "2026-10-18 16:00:00");
  // Monday 00:00:00 Shanghai starts the new week
  assert.equal(weekStartUtc(Date.UTC(2026, 9, 25, 16, 0, 0)), "2026-10-25 16:00:00");
});

test("balance board: real opted-in players only, medals on top three, no ids leaked", async () => {
  const s = Date.now().toString(36);
  const a = await register(`ca${s}`);
  const b = await register(`cb${s}`);
  const c = await register(`cc${s}`);
  const d = await register(`cd${s}`);
  const hidden = await register(`ch${s}`);
  const db = openDb();
  optIn(a.user.id, b.user.id, c.user.id, d.user.id);
  setBal(a.user.id, 9_000_001);
  setBal(b.user.id, 8_000_001);
  setBal(c.user.id, 7_000_001);
  setBal(d.user.id, 6_000_001);
  setBal(hidden.user.id, 99_000_000);
  db.prepare(`UPDATE users SET leaderboard_opt_in = 0 WHERE id = ?`).run(hidden.user.id);
  // bots (seeded, 10,000,000) must not appear
  const r = await api("/api/v1/leaderboard/coins?board=balance");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const e = r.json.data.entries;
  assert.deepEqual(e.slice(0, 4).map((x) => x.value), [9_000_001, 8_000_001, 7_000_001, 6_000_001]);
  assert.deepEqual(e.slice(0, 4).map((x) => x.avatarMedal || null), ["gold", "silver", "bronze", null]);
  assert.ok(e.length <= 20);
  assert.ok(!e.some((x) => x.value === 99_000_000));
  assert.ok(e.every((x) => !("userId" in x) && !("id" in x)));
  // self DTO carries the plaque too
  await as(a);
  const me = await api("/api/v1/me");
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.equal(me.json.data.user.avatarMedal, "gold");
});

test("viewer row: rank, or reason when not on the board", async () => {
  const s = Date.now().toString(36);
  const a = await register(`va${s}`);
  const out = await register(`vo${s}`);
  optIn(a.user.id);
  setBal(a.user.id, 5_500_000);
  await as(a);
  const mine = await api("/api/v1/leaderboard/coins?board=balance");
  assert.equal(mine.json.data.me.value, 5_500_000);
  assert.ok(Number.isInteger(mine.json.data.me.rank));
  await as(out);
  const no = await api("/api/v1/leaderboard/coins?board=balance");
  assert.equal(no.json.data.me.reason, "not_opted_in");
});

test("week board: counts play + daily income, ignores grants/purchases/old weeks, positives only", async () => {
  const s = Date.now().toString(36);
  const a = await register(`wa${s}`);
  const b = await register(`wb${s}`);
  const c = await register(`wc${s}`);
  const db = openDb();
  optIn(a.user.id, b.user.id, c.user.id);
  db.prepare(`DELETE FROM jiu_coin_ledger WHERE user_id IN (?,?,?)`).run(a.user.id, b.user.id, c.user.id);
  ledger(a.user.id, -100, "stake_escrow");
  ledger(a.user.id, 160, "stake_payout"); // +60
  ledger(a.user.id, 20, "daily_claim"); // 80
  ledger(a.user.id, 500, "achievement_claim"); // ignored
  ledger(a.user.id, -300, "frame_purchase"); // ignored
  ledger(a.user.id, 9999, "daily_claim", "2020-01-01 00:00:00"); // previous week: ignored
  ledger(b.user.id, -50, "stake_escrow"); // net loss → absent
  ledger(c.user.id, -20, "pvp_entry");
  ledger(c.user.id, 35, "pvp_reward"); // +15
  // Coins won on the wheel count (regression: the board listed "wheel_prize", the real reason is "lucky_wheel").
  const { WHEEL_REASON } = await import("../src/lib/luckyWheel.js");
  const d = await register(`wd${s}`);
  optIn(d.user.id);
  db.prepare(`DELETE FROM jiu_coin_ledger WHERE user_id = ?`).run(d.user.id);
  ledger(d.user.id, 300, WHEEL_REASON); // +300 → top of the board
  await as(a);
  const r = await api("/api/v1/leaderboard/coins?board=week");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const vals = r.json.data.entries.map((x) => x.value);
  assert.ok(vals.includes(80) && vals.includes(15));
  assert.ok(!vals.includes(-50) && !vals.includes(9999));
  assert.ok(vals.indexOf(80) < vals.indexOf(15));
  assert.ok(vals.includes(300), "wheel coin prizes are part of the week net");
  assert.equal(r.json.data.me.value, 80);
  assert.ok(r.json.data.entries.every((x) => !("avatarMedal" in x)), "week board carries no plaques");
  await as(b);
  const loser = await api("/api/v1/leaderboard/coins?board=week");
  assert.equal(loser.json.data.me.reason, "no_net_gain");
});

test("bad board → 400", async () => {
  const r = await api("/api/v1/leaderboard/coins?board=nope");
  assert.equal(r.status, 400);
});
