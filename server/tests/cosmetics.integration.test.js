import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.PVP_COSMETICS_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const defs = await import("../src/lib/cosmeticDefs.js");
const { entranceProp } = await import("../src/lib/cosmeticProp.js");
const { sendSticker, resetStickers } = await import("../src/lib/pvp/stickers.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => { await stop(); });

let seq = 0;
const uname = (p) => `${p}${Date.now().toString(36)}${seq++}`;
const state = async () => {
  const r = await api("/api/v1/me/cosmetics");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const buy = (auth, id) => api(`/api/v1/me/cosmetics/${id}/buy`, { method: "POST", csrf: auth.csrfToken, body: {} });
const equip = (auth, id) => api("/api/v1/me/cosmetics/equip-entrance", { method: "POST", csrf: auth.csrfToken, body: { id } });

test("catalogue invariants", () => {
  const ids = [...defs.PACKS.map((p) => p.id), ...defs.ENTRANCES.map((e) => e.id)];
  assert.equal(new Set(ids).size, ids.length, "item ids are unique across kinds");
  const stickers = defs.PACKS.flatMap((p) => p.stickers);
  assert.equal(new Set(stickers).size, stickers.length, "a sticker belongs to exactly one pack");
  for (const p of defs.PACKS) {
    assert.ok(p.stickers.length >= 6, p.id);
    assert.ok(["basic", "fine", "grand"].includes(p.tier), `${p.id} tier`);
    assert.ok(Number.isInteger(p.price) && p.price >= 100, p.id);
    for (const s of p.stickers) assert.equal(defs.stickerPack(s), p.id);
  }
  // the dearer the pack, the fancier the art: prices rise with the tier
  const priceOf = (tier) => defs.PACKS.filter((p) => p.tier === tier).map((p) => p.price);
  assert.ok(Math.min(...priceOf("fine")) > Math.max(...priceOf("basic")));
  assert.ok(Math.min(...priceOf("grand")) > Math.max(...priceOf("fine")));
  for (const e of defs.ENTRANCES) assert.ok(Number.isInteger(e.price) && e.price >= 100, e.id);
  assert.equal(defs.itemDef("nope"), null);
  assert.equal(defs.itemDef("ink_splash").kind, "entrance");
  assert.equal(defs.itemDef("pack_leek").kind, "pack");
  assert.equal(defs.isStickerId("__proto__"), false);
});

test("config exposes the flag; unauthenticated is 401; flag off reports disabled", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.pvpCosmetics, true);
  const jar = { ...ctx.jar };
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  assert.equal((await api("/api/v1/me/cosmetics")).status, 401);
  Object.assign(ctx.jar, jar);
  const auth = await register(uname("off"));
  config.pvpCosmeticsEnabled = false;
  try {
    assert.equal((await api("/api/v1/me/cosmetics")).json.data.enabled, false);
    const b = await buy(auth, "pack_market");
    assert.equal(b.status, 404);
    assert.equal(b.json.error.code, "FEATURE_DISABLED");
    assert.equal((await equip(auth, null)).status, 404);
    const st = await api("/api/v1/pvp/matches/none/stickers", { method: "POST", csrf: auth.csrfToken, body: { stickerId: "limit_up" } });
    assert.equal(st.status, 404);
    assert.equal(st.json.error.code, "FEATURE_DISABLED");
    assert.deepEqual(entranceProp("ink_splash"), {}, "no pvpEntrance in DTOs while off");
  } finally {
    config.pvpCosmeticsEnabled = true;
  }
});

test("buy a pack: pays once, 409 on repeat, 402 when short; balance matches the ledger", async () => {
  const auth = await register(uname("a"));
  const st0 = await state();
  assert.equal(st0.packs.length, 6);
  assert.equal(st0.packs[0].owned, false);
  assert.equal(st0.packs[0].affordable, true);
  const price = st0.packs[0].price;
  const before = getJiuCoinBalance(auth.user.id);
  const r = await buy(auth, st0.packs[0].id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(getJiuCoinBalance(auth.user.id), before - price);
  assert.equal(r.json.data.state.packs[0].owned, true);
  const again = await buy(auth, st0.packs[0].id);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_OWNED");
  assert.equal(getJiuCoinBalance(auth.user.id), before - price, "no second charge");
  const rows = openDb().prepare(`SELECT COUNT(*) c FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'cosmetic_purchase'`).get(auth.user.id).c;
  assert.equal(rows, 1);
  const unk = await buy(auth, "nope");
  assert.equal(unk.status, 404);
  // drain the account so the next purchase is short
  openDb().prepare(`UPDATE users SET jiu_coin_balance = 50 WHERE id = ?`).run(auth.user.id);
  const poor = await buy(auth, "gold_burst");
  assert.equal(poor.status, 402);
  assert.equal(poor.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(getJiuCoinBalance(auth.user.id), 50);
});

test("entrance effect: equip needs ownership; the choice reaches the public user; null takes it off", async () => {
  const auth = await register(uname("b"));
  const notOwned = await equip(auth, "ink_splash");
  assert.equal(notOwned.status, 403);
  assert.equal(notOwned.json.error.code, "NOT_OWNED");
  assert.equal((await equip(auth, "nope")).status, 404);
  assert.equal((await buy(auth, "ink_splash")).status, 200);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT - 400);
  const on = await equip(auth, "ink_splash");
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.data.user.pvpEntrance, "ink_splash");
  assert.equal((await state()).equippedEntrance, "ink_splash");
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.pvpEntrance, "ink_splash");
  const off = await equip(auth, null);
  assert.equal(off.status, 200);
  assert.equal(off.json.data.user.pvpEntrance, undefined);
  // a retired / unknown stored id never renders
  openDb().prepare(`UPDATE users SET pvp_entrance = 'retired_fx' WHERE id = ?`).run(auth.user.id);
  assert.equal((await state()).equippedEntrance, null);
  assert.equal((await api("/api/v1/me")).json.data.user.pvpEntrance, undefined);
});

function fakeDb({ status = "playing", owned = [] } = {}) {
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("FROM pvp_matches")) return { status };
          if (sql.includes("FROM users")) return { nickname: "表情甲", status: "active" };
          return undefined;
        },
        all() {
          if (sql.includes("pvp_match_players")) return [{ user_id: 1 }, { user_id: 2 }];
          if (sql.includes("user_cosmetics")) return owned.map((item_id) => ({ item_id }));
          return [];
        },
      };
    },
  };
}

test("sendSticker: ownership of the pack, playing only, rate limit, unknown ids", () => {
  resetStickers();
  const mine = fakeDb({ owned: ["pack_market"] });
  const ok = sendSticker(mine, { matchId: "m1", fromUserId: 1, stickerId: "limit_up", now: 1_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.event.stickerId, "limit_up");
  assert.equal(sendSticker(mine, { matchId: "m1", fromUserId: 1, stickerId: "limit_down", now: 1_500 }).status, 429);
  assert.equal(sendSticker(mine, { matchId: "m1", fromUserId: 1, stickerId: "limit_down", now: 4_000 }).ok, true);
  const notOwned = sendSticker(mine, { matchId: "m1", fromUserId: 1, stickerId: "got_cut", now: 9_000 });
  assert.equal(notOwned.status, 403);
  assert.equal(notOwned.code, "NOT_OWNED");
  assert.equal(sendSticker(mine, { matchId: "m1", fromUserId: 1, stickerId: "nope", now: 12_000 }).status, 400);
  assert.equal(sendSticker(fakeDb({ status: "settled", owned: ["pack_market"] }), { matchId: "m2", fromUserId: 1, stickerId: "limit_up", now: 20_000 }).status, 409);
  assert.equal(sendSticker(mine, { matchId: "m1", fromUserId: 9, stickerId: "limit_up", now: 30_000 }).status, 404);
});

test("a sticker pack cannot be equipped as an entrance effect (the client must not offer it)", async () => {
  const auth = await register(uname("pk"));
  const packs = (await state()).packs;
  assert.equal((await buy(auth, packs[0].id)).status, 200);
  const r = await equip(auth, packs[0].id);
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, "UNKNOWN_ITEM");
});
