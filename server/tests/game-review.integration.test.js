import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.GAME_REVIEW_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");
const { REVIEW_PRODUCTS } = await import("../src/lib/gameReview.js");
const { settleGame } = await import("../../shared/engine.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => { await stop(); });

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;
const review = (id) => api(`/api/v1/games/${id}/review`);
const unlock = (auth, id, product) => api(`/api/v1/games/${id}/review/unlock`, { method: "POST", csrf: auth.csrfToken, body: { product } });

async function playGame(auth, actions = ["buy", "hold", "hold", "sell", ...holds(25)], pick = { stockIndex: 0, windowStartIndex: 30, historyLength: 30 }) {
  const create = await api("/api/v1/games", {
    method: "POST", csrf: auth.csrfToken, headers: { "Idempotency-Key": `rv-${Date.now()}-${seq++}` },
    body: { fillMode: "next_open", pick },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const fin = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST", csrf: auth.csrfToken, body: { actions: actionsObj(actions), finish: true },
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.json));
  return { gameId, finish: fin.json.data };
}

const ledgerRows = (userId) => openDb().prepare(`SELECT delta, ref_id FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'review_purchase'`).all(userId);

test("catalogue: route 30, hold 10", () => {
  assert.equal(REVIEW_PRODUCTS.route.price, 30);
  assert.equal(REVIEW_PRODUCTS.hold.price, 10);
});

test("config exposes the flag; unauthenticated is 401; flag off reports disabled and blocks unlock", async () => {
  assert.equal((await api("/api/v1/config")).json.data.features.gameReview, true);
  const auth = await register(uname("off"));
  const { gameId } = await playGame(auth);
  config.gameReviewEnabled = false;
  try {
    assert.equal((await review(gameId)).json.data.enabled, false);
    const u = await unlock(auth, gameId, "route");
    assert.equal(u.status, 403);
    assert.equal(u.json.error.code, "FEATURE_DISABLED");
  } finally {
    config.gameReviewEnabled = true;
  }
  const jar = { ...ctx.jar };
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  assert.equal((await review(gameId)).status, 401);
  Object.assign(ctx.jar, jar);
});

test("locked state shows only the teaser; unlock charges once; route + window are returned", async () => {
  const auth = await register(uname("buy"));
  const { gameId, finish } = await playGame(auth);
  const st = (await review(gameId)).json.data;
  assert.equal(st.eligible, true);
  assert.deepEqual(st.owned, { route: false, hold: false });
  assert.equal(st.review, undefined);
  assert.equal(st.window, undefined);
  assert.deepEqual(Object.keys(st.teaser).sort(), ["capturePct", "optimalReturnPct", "yourReturnPct"]);
  assert.equal(st.teaser.yourReturnPct, Number(finish.returnPct));
  assert.ok(st.teaser.optimalReturnPct >= st.teaser.yourReturnPct - 0.01);
  assert.equal(st.products.find((p) => p.id === "route").buyable, true);
  assert.equal(st.products.find((p) => p.id === "hold").buyable, false);

  const before = getJiuCoinBalance(auth.user.id);
  const early = await unlock(auth, gameId, "hold");
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, "NEED_ROUTE");
  assert.equal(getJiuCoinBalance(auth.user.id), before, "no charge for a refused purchase");

  const bought = await unlock(auth, gameId, "route");
  assert.equal(bought.status, 200, JSON.stringify(bought.json));
  assert.equal(getJiuCoinBalance(auth.user.id), before - 30);
  const d = bought.json.data;
  assert.equal(d.bought, "route");
  assert.equal(d.owned.route, true);
  assert.equal(d.teaser, undefined);
  assert.ok(Array.isArray(d.review.route));
  assert.equal(d.review.hold, null, "death-hold is a separate purchase");
  assert.equal(d.window.bars.length, 30);
  assert.equal(d.window.history.length, 30);
  assert.equal(d.review.mine.returnPct, Number(finish.returnPct));

  // the route replays to exactly the advertised optimum under the real engine
  const rep = settleGame({ fillMode: "next_open", bars: d.window.bars, actions: d.review.optimal.actions });
  assert.ok(rep.ok);
  assert.ok(Math.abs((rep.equityMultiple - 1) * 100 - d.review.optimal.returnPct) < 0.011);
  assert.equal(d.review.route.length, d.review.optimal.actions.filter((a) => a !== "hold").length);

  assert.equal(ledgerRows(auth.user.id).length, 1);
  assert.equal(ledgerRows(auth.user.id)[0].delta, -30);
});

test("double tap / two tabs never double-charge", async () => {
  const auth = await register(uname("dbl"));
  const { gameId } = await playGame(auth);
  const before = getJiuCoinBalance(auth.user.id);
  const [a, b] = await Promise.all([unlock(auth, gameId, "route"), unlock(auth, gameId, "route")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(getJiuCoinBalance(auth.user.id), before - 30);
  const again = await unlock(auth, gameId, "route");
  assert.equal(again.json.error.code, "ALREADY_UNLOCKED");
  assert.equal(ledgerRows(auth.user.id).length, 1);
});

test("hold add-on: 10 coins, needs route, adds the curve", async () => {
  const auth = await register(uname("hold"));
  const { gameId } = await playGame(auth);
  await unlock(auth, gameId, "route");
  const before = getJiuCoinBalance(auth.user.id);
  const h = await unlock(auth, gameId, "hold");
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.equal(getJiuCoinBalance(auth.user.id), before - 10);
  assert.equal(h.json.data.review.hold.curve.length, 31);
  assert.equal(typeof h.json.data.review.hold.returnPct, "number");
  assert.equal((await unlock(auth, gameId, "hold")).json.error.code, "ALREADY_UNLOCKED");
  // survives a fresh read
  const re = (await review(gameId)).json.data;
  assert.deepEqual(re.owned, { route: true, hold: true });
  assert.equal(re.review.hold.curve.length, 31);
});

test("insufficient funds: 402, nothing recorded", async () => {
  const auth = await register(uname("poor"));
  const { gameId } = await playGame(auth);
  openDb().prepare(`UPDATE users SET jiu_coin_balance = 5 WHERE id = ?`).run(auth.user.id);
  const r = await unlock(auth, gameId, "route");
  assert.equal(r.status, 402);
  assert.equal(r.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(getJiuCoinBalance(auth.user.id), 5);
  assert.equal(ledgerRows(auth.user.id).length, 0);
  assert.equal(openDb().prepare(`SELECT COUNT(*) AS n FROM game_reviews WHERE game_id = ?`).get(gameId).n, 0);
  assert.equal((await review(gameId)).json.data.owned.route, false);
});

test("someone else's game is 404, unknown product 404, unsettled game is not eligible", async () => {
  const owner = await register(uname("own"));
  const { gameId } = await playGame(owner);
  const other = await register(uname("oth"));
  assert.equal((await review(gameId)).status, 404);
  const u = await unlock(other, gameId, "route");
  assert.equal(u.status, 404);
  assert.equal(getJiuCoinBalance(other.user.id), 500);

  const mine = await register(uname("act"));
  const create = await api("/api/v1/games", {
    method: "POST", csrf: mine.csrfToken, headers: { "Idempotency-Key": `act-${Date.now()}` },
    body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } },
  });
  const active = (await review(create.json.data.gameId)).json.data;
  assert.equal(active.eligible, false);
  assert.equal(active.reason, "NOT_SETTLED");
  assert.equal((await unlock(mine, create.json.data.gameId, "route")).status, 409);
  assert.equal((await unlock(mine, create.json.data.gameId, "nope")).status, 404);
});

test("game kinds: oneshot is capped at one buy, daily waits for the day to close, other kinds are unsupported", async () => {
  const auth = await register(uname("kind"));
  const { gameId } = await playGame(auth);
  const db = openDb();
  db.prepare(`UPDATE game_sessions SET game_kind = 'oneshot', modifiers = ? WHERE id = ?`).run(JSON.stringify({ maxBuys: 1, maxSells: 1 }), gameId);
  assert.equal((await unlock(auth, gameId, "route")).status, 200);
  const d = (await review(gameId)).json.data;
  assert.ok(d.review.optimal.actions.filter((a) => a === "buy").length <= 1);

  const g2 = await playGame(auth);
  db.prepare(`UPDATE game_sessions SET game_kind = 'daily', challenge_id = NULL WHERE id = ?`).run(g2.gameId);
  const nd = (await review(g2.gameId)).json.data;
  assert.equal(nd.eligible, false);
  assert.equal(nd.reason, "REVIEW_NOT_YET");
  assert.equal((await unlock(auth, g2.gameId, "route")).status, 422);

  const g3 = await playGame(auth);
  db.prepare(`UPDATE game_sessions SET game_kind = 'puzzle' WHERE id = ?`).run(g3.gameId);
  assert.equal((await review(g3.gameId)).json.data.reason, "REVIEW_UNSUPPORTED");
  assert.equal(getJiuCoinBalance(auth.user.id), 500 - 30 - 20 * 3 + 0, "only the oneshot unlock was charged (plus three game fees)");
});

test("我的战绩 list: each game says whether it can be reviewed and what was bought", async () => {
  const auth = await register(uname("lst"));
  const a = await playGame(auth);
  const b = await playGame(auth, undefined, { stockIndex: 1, windowStartIndex: 30, historyLength: 30 });
  assert.equal((await unlock(auth, a.gameId, "route")).status, 200);
  assert.equal((await unlock(auth, a.gameId, "hold")).status, 200);
  const list = await api("/api/v1/me/games?limit=10");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.data.items;
  const ia = items.find((g) => g.gameId === a.gameId);
  const ib = items.find((g) => g.gameId === b.gameId);
  assert.deepEqual(ia.review, { supported: true, owned: { route: true, hold: true } });
  assert.deepEqual(ib.review, { supported: true, owned: { route: false, hold: false } });
  config.gameReviewEnabled = false;
  try {
    const off = await api("/api/v1/me/games?limit=10");
    assert.equal(off.json.data.items[0].review, undefined, "flag off: list unchanged");
  } finally {
    config.gameReviewEnabled = true;
  }
});
