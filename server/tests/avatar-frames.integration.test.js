import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.AVATAR_FRAMES_ENABLED = "1";
process.env.ACHIEVEMENTS_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const { forceResultRanking } = await import("../src/lib/leaderboard.js");
const { FRAMES, frameDef, isFrameId } = await import("../src/lib/frameDefs.js");
const { ACHIEVEMENTS } = await import("../src/lib/achievements.js");
const { frameProp, shapeFrame } = await Promise.all([import("../src/lib/frameProp.js"), import("../src/lib/avatarFrames.js")]).then(
  ([a, b]) => ({ frameProp: a.frameProp, shapeFrame: b.shapeFrame })
);

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => { await stop(); });

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;
const state = async () => {
  const r = await api("/api/v1/me/frames");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const frame = (st, id) => st.frames.find((f) => f.id === id);
const buy = (auth, id) => api(`/api/v1/me/frames/${id}/buy`, { method: "POST", csrf: auth.csrfToken, body: {} });
const equip = (auth, frameId) => api("/api/v1/me/frames/equip", { method: "POST", csrf: auth.csrfToken, body: { frameId } });

test("catalogue invariants", () => {
  assert.equal(FRAMES.length, 9);
  assert.equal(new Set(FRAMES.map((f) => f.id)).size, 9);
  const shop = FRAMES.filter((f) => f.kind === "shop");
  assert.equal(shop.length, 7);
  for (const f of shop) assert.ok(Number.isInteger(f.price) && f.price >= 100 && f.price <= 2000, f.id);
  assert.deepEqual(shop.map((f) => f.price), [100, 300, 500, 800, 1000, 1500, 2000]);
  assert.deepEqual(shop.map((f) => f.price), [...shop.map((f) => f.price)].sort((a, b) => a - b), "listed cheapest first");
  // every achievement-only frame is actually earnable, and every unlock points at a real frame
  const unlockIds = ACHIEVEMENTS.filter((a) => a.unlock).map((a) => a.unlock.replace("frame:", ""));
  for (const id of unlockIds) assert.ok(isFrameId(id), `unlock ${id} is a frame`);
  for (const f of FRAMES.filter((x) => x.kind === "achievement")) assert.ok(unlockIds.includes(f.id), `${f.id} can be earned`);
  assert.equal(frameDef("nope"), null);
  assert.equal(isFrameId(undefined), false);
});

test("frameProp: only for a known id while the flag is on", () => {
  assert.deepEqual(frameProp("gold"), { avatarFrame: "gold" });
  assert.deepEqual(frameProp("retired_frame"), {});
  assert.deepEqual(frameProp(null), {});
  config.avatarFramesEnabled = false;
  try { assert.deepEqual(frameProp("gold"), {}); } finally { config.avatarFramesEnabled = true; }
});

test("shapeFrame: buyable / affordable only for unowned shop frames", () => {
  const shop = frameDef("gold");
  assert.deepEqual(
    (({ buyable, affordable, price }) => ({ buyable, affordable, price }))(shapeFrame(shop, { owned: false, equipped: false, balance: 1499 })),
    { buyable: true, affordable: false, price: 1500 }
  );
  assert.equal(shapeFrame(shop, { owned: false, equipped: false, balance: 1500 }).affordable, true);
  assert.equal(shapeFrame(shop, { owned: true, equipped: true, balance: 0 }).buyable, false);
  const ach = shapeFrame(frameDef("laurel"), { owned: false, equipped: false, balance: 99999 });
  assert.deepEqual([ach.buyable, ach.price, ach.hint !== null], [false, null, true]);
});

test("config exposes avatarFrames; unauthenticated is 401", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.avatarFrames, true);
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  assert.equal((await api("/api/v1/me/frames")).status, 401);
});

test("fresh user: nothing owned, nothing equipped", async () => {
  await register(uname("a"));
  const st = await state();
  assert.equal(st.enabled, true);
  assert.equal(st.equipped, null);
  assert.equal(st.balance, JIU_COIN_REGISTER_GRANT);
  assert.equal(st.frames.filter((f) => f.owned).length, 0);
  assert.equal(frame(st, "ink_ring").affordable, true);
  assert.equal(frame(st, "cinnabar").affordable, false);
  assert.equal(frame(st, "laurel").buyable, false);
});

test("buy: pays once, ledger row, ownership; replays / poverty / not-for-sale are refused without charging", async () => {
  const auth = await register(uname("b"));
  const r = await buy(auth, "ink_ring");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT - 300);
  assert.equal(frame(r.json.data.state, "ink_ring").owned, true);
  const ledger = openDb().prepare(`SELECT delta, balance_after FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'frame_purchase'`).all(auth.user.id);
  assert.deepEqual(ledger, [{ delta: -300, balance_after: JIU_COIN_REGISTER_GRANT - 300 }]);

  const again = await buy(auth, "ink_ring");
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_OWNED");

  const poor = await buy(auth, "cinnabar"); // 800 > 200
  assert.equal(poor.status, 402);
  assert.equal(poor.json.error.code, "INSUFFICIENT_FUNDS");

  const nfs = await buy(auth, "laurel");
  assert.equal(nfs.status, 409);
  assert.equal(nfs.json.error.code, "NOT_FOR_SALE");
  assert.equal((await buy(auth, "nope")).status, 404);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT - 300, "refusals cost nothing");
});

test("equip: must own; shows up in /me; can be taken off", async () => {
  const auth = await register(uname("c"));
  const no = await equip(auth, "bamboo");
  assert.equal(no.status, 403);
  assert.equal(no.json.error.code, "NOT_OWNED");
  assert.equal((await equip(auth, "nope")).status, 404);

  assert.equal((await buy(auth, "bamboo")).status, 200); // 500 = whole starting balance
  const on = await equip(auth, "bamboo");
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.data.user.avatarFrame, "bamboo");
  assert.equal(on.json.data.equipped, "bamboo");
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.avatarFrame, "bamboo");

  const off = await equip(auth, null);
  assert.equal(off.status, 200);
  assert.equal(off.json.data.user.avatarFrame, undefined);
  assert.equal((await api("/api/v1/me")).json.data.user.avatarFrame, undefined);
});

test("achievement unlock grants the frame for free (7-day cycles → ink_ring)", async () => {
  const auth = await register(uname("d"));
  openDb().prepare(`INSERT INTO login_streaks (user_id, cycle_pos, run_days, best_run, cycles_done, total_claims, last_claim_date)
                    VALUES (?, 7, 21, 21, 3, 21, '2026-01-01')`).run(auth.user.id);
  assert.equal(frame(await state(), "ink_ring").owned, false, "not before claiming the achievement");
  const claim = await api("/api/v1/me/achievements/streak_cycle_3/claim", { method: "POST", csrf: auth.csrfToken, body: {} });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
  const st = await state();
  assert.equal(frame(st, "ink_ring").owned, true);
  assert.equal(frame(st, "ink_ring").buyable, false);
  assert.equal((await equip(auth, "ink_ring")).status, 200);
  const before = getJiuCoinBalance(auth.user.id);
  assert.equal((await buy(auth, "ink_ring")).json.error.code, "ALREADY_OWNED");
  assert.equal(getJiuCoinBalance(auth.user.id), before);
});

test("equipped frame rides along on the leaderboard (and equip refreshes the cached board)", async () => {
  const auth = await register(uname("e"));
  const optIn = await api("/api/v1/me", { method: "PATCH", csrf: auth.csrfToken, body: { leaderboardOptIn: true } });
  assert.equal(optIn.status, 200);
  const create = await api("/api/v1/games", {
    method: "POST", csrf: auth.csrfToken, headers: { "Idempotency-Key": `fr-${Date.now()}` },
    body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const fin = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST", csrf: auth.csrfToken, body: { actions: actionsObj(["buy", "sell", ...holds(27)]), finish: true },
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.json));
  forceResultRanking(gameId, { returnPpm: 777000, finishedAt: "2026-09-03T08:00:00.000Z" });

  const mine = (b) => b.json.data.top10.find((r) => r.returnPpm === 777000);
  const before = await api("/api/v1/leaderboard?fillMode=next_open");
  assert.ok(mine(before), "on the board");
  assert.equal(mine(before).avatarFrame, undefined);

  assert.equal((await buy(auth, "ink_ring")).status, 200);
  assert.equal((await equip(auth, "ink_ring")).status, 200);
  const after = await api("/api/v1/leaderboard?fillMode=next_open");
  assert.equal(mine(after).avatarFrame, "ink_ring");
});

test("flag off: endpoint disabled, buy / equip rejected, DTOs carry no frame", async () => {
  const auth = await register(uname("f"));
  assert.equal((await buy(auth, "ink_ring")).status, 200);
  assert.equal((await equip(auth, "ink_ring")).status, 200);
  config.avatarFramesEnabled = false;
  try {
    const st = await api("/api/v1/me/frames");
    assert.equal(st.json.data.enabled, false);
    assert.equal(st.json.data.frames, undefined);
    const b = await buy(auth, "bamboo");
    assert.equal(b.status, 404);
    assert.equal(b.json.error.code, "FEATURE_DISABLED");
    assert.equal((await equip(auth, null)).status, 404);
    assert.equal((await api("/api/v1/me")).json.data.user.avatarFrame, undefined, "stored frame is hidden, not lost");
  } finally {
    config.avatarFramesEnabled = true;
  }
  assert.equal((await api("/api/v1/me")).json.data.user.avatarFrame, "ink_ring");
});
