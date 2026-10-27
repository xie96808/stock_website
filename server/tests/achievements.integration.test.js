import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.ACHIEVEMENTS_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const ach = await import("../src/lib/achievements.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => { await stop(); });

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;

async function state() {
  const r = await api("/api/v1/me/achievements");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}
const item = (st, key) => st.items.find((i) => i.key === key);

let gk = 0;
async function settle(auth, actions = holds(29)) {
  const create = await api("/api/v1/games", {
    method: "POST", csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `ach-${Date.now()}-${gk++}` },
    body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const fin = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST", csrf: auth.csrfToken, body: { actions: actionsObj(actions), finish: true },
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.json));
  return gameId;
}

function claim(auth, key) {
  return api(`/api/v1/me/achievements/${key}/claim`, { method: "POST", csrf: auth.csrfToken, body: {} });
}

test("definitions are sane", () => {
  const keys = ach.ACHIEVEMENTS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, "unique keys");
  for (const a of ach.ACHIEVEMENTS) {
    assert.ok(ach.METRICS[a.metric], `metric ${a.metric}`);
    assert.ok(a.target >= 1 && a.coins > 0, a.key);
    assert.ok(ach.GROUPS.some((g) => g.id === a.group), `group of ${a.key}`);
    if (a.unlock) assert.match(a.unlock, /^frame:[a-z_]+$/);
  }
  const total = ach.ACHIEVEMENTS.reduce((s, a) => s + a.coins, 0);
  assert.ok(total >= 8000 && total <= 25000, `lifetime coins ${total} out of the intended range`);
  // staying / inviting must clearly out-pay the plain daily login income (7-day cycle pays 260 coins)
  const by = Object.fromEntries(ach.ACHIEVEMENTS.map((a) => [a.key, a]));
  assert.ok(by.streak_30.coins >= 1000 && by.streak_7.coins > 100 && by.invite_1.coins >= 150);
  // tiers of one metric are strictly increasing
  const byMetric = {};
  for (const a of ach.ACHIEVEMENTS) (byMetric[a.metric] ||= []).push(a);
  for (const list of Object.values(byMetric)) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].target > list[i - 1].target && list[i].coins > list[i - 1].coins, list[i].key);
    }
  }
});

test("shapeItem: progress is capped and claimable only when reached and unclaimed", () => {
  const def = { key: "k", group: "play", name: "n", desc: "d", target: 10, coins: 40 };
  assert.deepEqual(
    (({ progress, done, claimed, claimable }) => ({ progress, done, claimed, claimable }))(ach.shapeItem(def, 3, null)),
    { progress: 3, done: false, claimed: false, claimable: false }
  );
  const reached = ach.shapeItem(def, 99, null);
  assert.equal(reached.progress, 10);
  assert.equal(reached.claimable, true);
  const paid = ach.shapeItem(def, 99, { claimed_at: "2026-01-01" });
  assert.deepEqual([paid.claimed, paid.claimable], [true, false]);
  assert.equal(ach.shapeItem(def, -5, null).progress, 0);
  assert.equal(ach.shapeItem(def, "x", null).progress, 0);
});

test("config exposes achievements; unauthenticated is 401", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.achievements, true);
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  assert.equal((await api("/api/v1/me/achievements")).status, 401);
});

test("fresh user: nothing claimable; first settled game unlocks games_1; claim pays once", async () => {
  const auth = await register(uname("a"));
  let st = await state();
  assert.equal(st.enabled, true);
  assert.equal(st.summary.claimable, 0);
  assert.equal(item(st, "games_1").progress, 0);

  await settle(auth);
  st = await state();
  assert.equal(item(st, "games_1").claimable, true);
  assert.equal(st.summary.claimable, 1);
  assert.equal(st.summary.claimableCoins, 20);

  const before = getJiuCoinBalance(auth.user.id);
  const r = await claim(auth, "games_1");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.coins, 20);
  assert.equal(getJiuCoinBalance(auth.user.id), before + 20);
  assert.equal(item(r.json.data.state, "games_1").claimed, true);

  const again = await claim(auth, "games_1");
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_CLAIMED");
  assert.equal(getJiuCoinBalance(auth.user.id), before + 20, "no second payout");
  const rows = openDb().prepare(`SELECT COUNT(*) c FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'achievement_claim'`).get(auth.user.id).c;
  assert.equal(rows, 1);
});

test("not reached / unknown key", async () => {
  const auth = await register(uname("b"));
  const nr = await claim(auth, "games_200");
  assert.equal(nr.status, 409);
  assert.equal(nr.json.error.code, "NOT_REACHED");
  const unk = await claim(auth, "nope_nope");
  assert.equal(unk.status, 404);
  assert.equal(unk.json.error.code, "UNKNOWN_ACHIEVEMENT");
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT);
});

test("claim-all collects every reached tier once; second call pays nothing", async () => {
  const auth = await register(uname("c"));
  await settle(auth);
  const db = openDb();
  db.prepare(`INSERT INTO login_streaks (user_id, cycle_pos, run_days, best_run, cycles_done, total_claims, last_claim_date)
              VALUES (?, 7, 7, 7, 1, 7, '2026-01-01')`).run(auth.user.id);
  const before = getJiuCoinBalance(auth.user.id);
  const r = await api("/api/v1/me/achievements/claim-all", { method: "POST", csrf: auth.csrfToken, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const keys = r.json.data.claimed.map((c) => c.key).sort();
  assert.deepEqual(keys, ["games_1", "streak_3", "streak_7"]);
  assert.equal(r.json.data.coins, 20 + 60 + 200);
  assert.equal(getJiuCoinBalance(auth.user.id), before + 280);
  const second = await api("/api/v1/me/achievements/claim-all", { method: "POST", csrf: auth.csrfToken, body: {} });
  assert.equal(second.status, 200);
  assert.equal(second.json.data.coins, 0);
  assert.deepEqual(second.json.data.claimed, []);
  assert.equal(getJiuCoinBalance(auth.user.id), before + 280);
});

test("other metrics read the right tables", async () => {
  const auth = await register(uname("d"));
  const db = openDb();
  const u = auth.user.id;
  db.pragma("foreign_keys = OFF");
  try {
    // quiz: 7 settled days (+1 in progress that must not count)
    for (let i = 0; i < 7; i++) {
      db.prepare(`INSERT INTO quiz_attempts (id, user_id, set_date, set_version, status) VALUES (?, ?, ?, 'v1', 'settled')`).run(`q${u}-${i}`, u, `2026-02-0${i + 1}`);
    }
    db.prepare(`INSERT INTO quiz_attempts (id, user_id, set_date, set_version, status) VALUES (?, ?, '2026-02-20', 'v1', 'in_progress')`).run(`q${u}-x`, u);
    // invites: 1 rewarded, 1 pending
    db.prepare(`INSERT INTO invite_redemptions (invitee_id, inviter_id, code, status) VALUES (9001, ?, 'AAAAAA', 'rewarded')`).run(u);
    db.prepare(`INSERT INTO invite_redemptions (invitee_id, inviter_id, code, status) VALUES (9002, ?, 'AAAAAA', 'pending')`).run(u);
    // puzzle: 2 cleared levels + 1 with zero stars
    for (const [k, s] of [["l1", 1], ["l2", 3], ["l3", 0]]) {
      db.prepare(`INSERT INTO puzzle_progress (user_id, chapter_id, level_key, reward_family_id, best_stars) VALUES (?, 'c1', ?, 'f', ?)`).run(u, k, s);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
  const st = await state();
  assert.equal(item(st, "quiz_7").claimable, true);
  assert.equal(item(st, "quiz_1").claimable, true);
  assert.equal(item(st, "invite_1").claimable, true);
  assert.equal(item(st, "invite_5").progress, 1);
  assert.equal(item(st, "puzzle_1").claimable, true);
  assert.equal(item(st, "puzzle_10").progress, 2);
  assert.equal(item(st, "games_1").claimable, false);
});

test("best single-game return unlocks the laurel frame; unlocks are readable", async () => {
  const auth = await register(uname("e"));
  const gameId = await settle(auth, ["buy", "sell", ...holds(27)]);
  const db = openDb();
  // A game with no trade never counts, however good the number looks.
  db.prepare(`UPDATE game_results SET return_ppm = 900000, trade_count = 0 WHERE game_id = ?`).run(gameId);
  assert.equal(item(await state(), "ret_20").progress, 0);
  db.prepare(`UPDATE game_results SET return_ppm = 600000, trade_count = 2 WHERE game_id = ?`).run(gameId);
  const st = await state();
  assert.equal(item(st, "ret_20").claimable, true);
  assert.equal(item(st, "ret_50").claimable, true);
  assert.equal(item(st, "profit_1").claimable, true);
  assert.deepEqual(st.unlocks, []);
  const r = await claim(auth, "ret_50");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.claimed[0].unlock, "frame:laurel");
  assert.deepEqual(r.json.data.state.unlocks, ["frame:laurel"]);
  assert.deepEqual(ach.getAchievementUnlocks(auth.user.id), ["frame:laurel"]);
});

test("bestRun is the longest run of true", () => {
  assert.equal(ach.bestRun([]), 0);
  assert.equal(ach.bestRun([false, false]), 0);
  assert.equal(ach.bestRun([true, true, false, true, true, true, false]), 3);
  assert.equal(ach.bestRun([true, true, true]), 3);
});

test("高手 metrics: drawdown, benchmark, streak and average only count real, unrewound, traded games", async () => {
  const auth = await register(uname("g"));
  const db = openDb();
  const u = auth.user.id;
  const gameId = await settle(auth, ["buy", "sell", ...holds(27)]);
  const set = (id, f) =>
    db.prepare(`UPDATE game_results SET return_ppm = ?, trade_count = ?, mdd_ppm = ?, benchmark_return_ppm = ?, assist_class = ?, created_at = ? WHERE game_id = ?`)
      .run(f.ret, f.trades ?? 2, f.mdd, f.bench, f.assist ?? "clean", f.at ?? "2026-03-01 10:00:00", id);

  // +25%, drawdown 3%, benchmark +10%  → calm big win, beats benchmark, within both drawdown bands
  set(gameId, { ret: 250000, mdd: 30000, bench: 100000 });
  let st = await state();
  assert.equal(item(st, "calm_20").claimable, true);
  assert.equal(item(st, "dd5_1").claimable, true);
  assert.equal(item(st, "dd10_1").claimable, true);
  assert.equal(item(st, "beat_1").claimable, true);
  assert.equal(item(st, "dd5_10").progress, 1);
  assert.equal(item(st, "avg_2").progress, 0, "average needs at least 10 games");

  // 8% drawdown only reaches the 10% band; losing to the benchmark does not count
  set(gameId, { ret: 250000, mdd: 80000, bench: 400000 });
  st = await state();
  assert.equal(item(st, "dd10_1").claimable, true);
  assert.equal(item(st, "dd5_1").progress, 0);
  assert.equal(item(st, "calm_20").progress, 0);
  assert.equal(item(st, "beat_1").progress, 0);

  // legacy rows (no mdd / benchmark recorded) never count
  set(gameId, { ret: 250000, mdd: null, bench: null });
  st = await state();
  assert.equal(item(st, "dd10_1").progress, 0);
  assert.equal(item(st, "beat_1").progress, 0);

  // a rewound game and a no-trade game are ignored by every skill metric
  set(gameId, { ret: 250000, mdd: 10000, bench: 0, assist: "undo" });
  st = await state();
  for (const k of ["dd10_1", "dd5_1", "calm_20", "beat_1", "wstreak_3"]) assert.equal(item(st, k).progress, 0, k);
  set(gameId, { ret: 250000, mdd: 10000, bench: 0, trades: 0 });
  assert.equal(item(await state(), "dd5_1").progress, 0);

  // clone the session/result 9 more times: 10 qualifying games, returns +4% ×10 → avg 4%, one losing game in the middle
  set(gameId, { ret: 40000, mdd: 10000, bench: 0, at: "2026-03-01 10:00:00" });
  const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  const res = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
  const ins = (table, row) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
  };
  for (let i = 1; i < 10; i++) {
    const id = `${gameId}-c${i}`;
    ins("game_sessions", { ...sess, id, create_key: `ck-${u}-${i}` });
    ins("game_results", { ...res, game_id: id, created_at: `2026-03-01 10:${String(i).padStart(2, "0")}:00` });
  }
  st = await state();
  assert.equal(item(st, "avg_2").claimable, true, "10 games at +4% average");
  assert.equal(item(st, "avg_5").progress, 4);
  assert.equal(item(st, "wstreak_8").progress, 8, "streak progress is capped at the target");
  assert.equal(item(st, "wstreak_5").claimable, true);

  // a loss in the middle splits the streak: 5 wins, loss, 4 wins → best run 5
  db.prepare(`UPDATE game_results SET return_ppm = -50000 WHERE game_id = ?`).run(`${gameId}-c5`);
  st = await state();
  assert.equal(item(st, "wstreak_5").claimable, true);
  assert.equal(item(st, "wstreak_8").progress, 5);
});

test("flag off: endpoint reports disabled and claims are rejected", async () => {
  const auth = await register(uname("f"));
  await settle(auth);
  config.achievementsEnabled = false;
  try {
    const r = await api("/api/v1/me/achievements");
    assert.equal(r.json.data.enabled, false);
    assert.equal(r.json.data.items, undefined);
    const c = await claim(auth, "games_1");
    assert.equal(c.status, 404);
    assert.equal(c.json.error.code, "FEATURE_DISABLED");
    const all = await api("/api/v1/me/achievements/claim-all", { method: "POST", csrf: auth.csrfToken, body: {} });
    assert.equal(all.status, 404);
  } finally {
    config.achievementsEnabled = true;
  }
  assert.equal((await claim(auth, "games_1")).status, 200);
});
