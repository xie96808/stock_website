import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.TITLE_SHOP_ENABLED = "1";
process.env.RENAME_CARD_ENABLED = "1";
process.env.COIN_BOARD_ENABLED = "1";
process.env.COIN_BOARD_CACHE_TTL_MS = "0";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");
const { TITLES, titleDef, isTitleId } = await import("../src/lib/titleDefs.js");
const { titleProp, titlePropFromRaw } = await import("../src/lib/titleProp.js");
const { RENAME_CARD_PRICE } = await import("../src/lib/renameCards.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => { await stop(); });

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;
const setBal = (id, n) => openDb().prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`).run(n, id);
const titles = async () => (await api("/api/v1/me/titles")).json.data;
const buyTitle = (auth, id) => api(`/api/v1/me/titles/${id}/buy`, { method: "POST", csrf: auth.csrfToken, body: {} });
const equipTitle = (auth, titleId) => api("/api/v1/me/titles/equip", { method: "POST", csrf: auth.csrfToken, body: { titleId } });
const buyCard = (auth) => api("/api/v1/me/rename-card/buy", { method: "POST", csrf: auth.csrfToken, body: {} });
const rename = (auth, nickname) => api("/api/v1/me", { method: "PATCH", csrf: auth.csrfToken, body: { nickname } });

test("title catalogue: unique ids, whole-coin prices rising with the tier", () => {
  assert.equal(new Set(TITLES.map((t) => t.id)).size, TITLES.length);
  const rank = { plain: 0, red: 1, gold: 2, shine: 3, legend: 4 };
  let prevPrice = 0;
  let prevRank = 0;
  for (const t of TITLES) {
    assert.ok(Number.isInteger(t.price) && t.price >= 100, t.id);
    assert.ok(t.name.length >= 3 && t.name.length <= 8, `${t.id} name length`);
    assert.ok(t.price >= prevPrice && rank[t.tier] >= prevRank, `${t.id} is not cheaper / plainer than the one before`);
    prevPrice = t.price;
    prevRank = rank[t.tier];
  }
  assert.equal(titleDef("nope"), null);
  assert.equal(isTitleId("__proto__"), false);
});

test("shopTitle prop: known id + flag on only (and it never collides with the PvP rank `title`)", () => {
  assert.deepEqual(titlePropFromRaw("rookie"), { shopTitle: "rookie" });
  assert.deepEqual(titlePropFromRaw("retired"), {});
  assert.deepEqual(titlePropFromRaw(null), {});
  config.titleShopEnabled = false;
  try {
    assert.deepEqual(titlePropFromRaw("rookie"), {});
    assert.deepEqual(titleProp(1), {});
  } finally {
    config.titleShopEnabled = true;
  }
});

test("flags off: tabs report disabled, buying is FEATURE_DISABLED, renaming stays free", async () => {
  const auth = await register(uname("off"));
  config.titleShopEnabled = false;
  config.renameCardEnabled = false;
  try {
    assert.equal((await api("/api/v1/me/titles")).json.data.enabled, false);
    assert.equal((await api("/api/v1/me/rename-card")).json.data.enabled, false);
    assert.equal((await buyTitle(auth, "rookie")).json.error.code, "FEATURE_DISABLED");
    assert.equal((await buyCard(auth)).json.error.code, "FEATURE_DISABLED");
    const r = await rename(auth, `改${seq}号`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.user.renameCards, undefined);
  } finally {
    config.titleShopEnabled = true;
    config.renameCardEnabled = true;
  }
});

test("buy a title: pays once, ledger row, refusals cost nothing; equip needs ownership; shows on /me", async () => {
  const auth = await register(uname("t"));
  setBal(auth.user.id, 1000);
  const poor = await buyTitle(auth, "leek_emperor"); // 2000
  assert.equal(poor.status, 402);
  assert.equal(poor.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal((await buyTitle(auth, "nope")).status, 404);
  assert.equal((await equipTitle(auth, "bag_holder")).json.error.code, "NOT_OWNED");

  const ok = await buyTitle(auth, "bag_holder"); // 500
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(getJiuCoinBalance(auth.user.id), 500);
  const again = await buyTitle(auth, "bag_holder");
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_OWNED");
  assert.equal(getJiuCoinBalance(auth.user.id), 500, "refusals cost nothing");
  const ledger = openDb().prepare(`SELECT delta FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'title_purchase'`).all(auth.user.id);
  assert.deepEqual(ledger, [{ delta: -500 }]);

  const on = await equipTitle(auth, "bag_holder");
  assert.equal(on.status, 200);
  assert.equal(on.json.data.user.shopTitle, "bag_holder");
  assert.equal((await api("/api/v1/me")).json.data.user.shopTitle, "bag_holder");
  const st = await titles();
  assert.equal(st.equipped, "bag_holder");
  assert.equal(st.titles.find((t) => t.id === "bag_holder").owned, true);
  const off = await equipTitle(auth, null);
  assert.equal(off.json.data.user.shopTitle, undefined);
});

test("a worn title shows on the 韭币榜 rows", async () => {
  const auth = await register(uname("b"));
  setBal(auth.user.id, 9_100_000);
  openDb().prepare(`UPDATE users SET leaderboard_opt_in = 1 WHERE id = ?`).run(auth.user.id);
  openDb().prepare(`INSERT INTO user_titles (user_id, title_id, price) VALUES (?, 'rookie', 200)`).run(auth.user.id);
  assert.equal((await equipTitle(auth, "rookie")).status, 200);
  const r = await api("/api/v1/leaderboard/coins?board=balance");
  const mine = r.json.data.entries.find((e) => e.value === 9_100_000);
  assert.ok(mine, "on the board");
  assert.equal(mine.shopTitle, "rookie");
  assert.ok(!("userId" in mine) && !("id" in mine));
});

test("改名卡: a rename needs a card; buying one costs 300 and a rename spends it; the trail is logged", async () => {
  const auth = await register(uname("r"));
  setBal(auth.user.id, 1000);
  const first = await api("/api/v1/me");
  assert.equal(first.json.data.user.renameCards, 0);

  const blocked = await rename(auth, `新名${seq}A`);
  assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error.code, "RENAME_CARD_REQUIRED");
  assert.equal((await api("/api/v1/me")).json.data.user.nickname, first.json.data.user.nickname, "nickname unchanged");

  // other profile fields stay free, and re-saving the same nickname is not a rename
  const sig = await api("/api/v1/me", { method: "PATCH", csrf: auth.csrfToken, body: { signature: "你好", nickname: first.json.data.user.nickname } });
  assert.equal(sig.status, 200, JSON.stringify(sig.json));

  const bought = await buyCard(auth);
  assert.equal(bought.status, 200, JSON.stringify(bought.json));
  assert.equal(bought.json.data.user.renameCards, 1);
  assert.equal(getJiuCoinBalance(auth.user.id), 1000 - RENAME_CARD_PRICE);

  const nick = `新名${seq}B`;
  const done = await rename(auth, nick);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.user.nickname, nick);
  assert.equal(done.json.data.user.renameCards, 0);
  const log = openDb().prepare(`SELECT old_nickname, new_nickname, used_card FROM nickname_changes WHERE user_id = ?`).all(auth.user.id);
  assert.deepEqual(log, [{ old_nickname: first.json.data.user.nickname, new_nickname: nick, used_card: 1 }]);
  assert.equal((await rename(auth, `新名${seq}C`)).json.error.code, "RENAME_CARD_REQUIRED", "the card was spent");

  // two purchases in a row are two distinct ledger rows (the unique ref_id counts purchases)
  await buyCard(auth);
  await buyCard(auth);
  const rows = openDb().prepare(`SELECT ref_id FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'rename_card_purchase' ORDER BY id`).all(auth.user.id);
  assert.deepEqual(rows.map((x) => x.ref_id.split(":")[1]), ["1", "2", "3"]);
  assert.equal(getJiuCoinBalance(auth.user.id), 1000 - 3 * RENAME_CARD_PRICE);
});

test("改名卡: too poor is refused without charging; admins rename for free", async () => {
  const poor = await register(uname("p"));
  setBal(poor.user.id, RENAME_CARD_PRICE - 1);
  const r = await buyCard(poor);
  assert.equal(r.status, 402);
  assert.equal(getJiuCoinBalance(poor.user.id), RENAME_CARD_PRICE - 1);
  openDb().prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(poor.user.id);
  const free = await rename(poor, `管${seq}理`);
  assert.equal(free.status, 200, JSON.stringify(free.json));
  const log = openDb().prepare(`SELECT used_card FROM nickname_changes WHERE user_id = ?`).all(poor.user.id);
  assert.deepEqual(log, [{ used_card: 0 }]);
});
