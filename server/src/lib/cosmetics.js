/**
 * 对战装扮 — sticker packs and entrance effects, bought with 韭币 (a sink). Packs are owned forever; one entrance effect
 * can be equipped. Equip validates ownership at write time; public DTOs re-validate the stored id (entranceProp).
 */
import { openDb } from "../db/connection.js";
import { PACKS, ENTRANCES, itemDef, entranceDef } from "./cosmeticDefs.js";
import { pvpCosmeticsEnabled } from "./cosmeticProp.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

export { pvpCosmeticsEnabled };

export function ownedItemIds(userId, db = openDb()) {
  return new Set(db.prepare(`SELECT item_id FROM user_cosmetics WHERE user_id = ?`).all(userId).map((r) => r.item_id));
}

function equippedEntrance(userId, db) {
  const raw = db.prepare(`SELECT pvp_entrance AS e FROM users WHERE id = ?`).get(userId)?.e || null;
  return raw && entranceDef(raw) ? raw : null;
}

/** Pure: shape one purchasable for the client. */
export function shapeItem(kind, def, { owned, equipped = false, balance }) {
  return {
    id: def.id,
    kind,
    name: def.name,
    desc: def.desc,
    price: def.price,
    owned: !!owned,
    equipped: !!equipped,
    buyable: !owned,
    affordable: !owned ? balance >= def.price : false,
    ...(kind === "pack" ? { stickers: [...def.stickers], tier: def.tier || "basic" } : {}),
  };
}

export function getCosmeticState(userId, { db = openDb() } = {}) {
  const owned = ownedItemIds(userId, db);
  const equipped = equippedEntrance(userId, db);
  const balance = getJiuCoinBalance(userId, db);
  return {
    enabled: pvpCosmeticsEnabled(),
    balance,
    equippedEntrance: equipped,
    packs: PACKS.map((p) => shapeItem("pack", p, { owned: owned.has(p.id), balance })),
    entrances: ENTRANCES.map((e) => shapeItem("entrance", e, { owned: owned.has(e.id), equipped: equipped === e.id, balance })),
  };
}

function guard(db, userId) {
  if (!pvpCosmeticsEnabled()) {
    return { error: { status: 404, code: "FEATURE_DISABLED", message: "对战装扮暂未开放" } };
  }
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能操作" } };
  }
  return null;
}

export function buyCosmetic(userId, itemId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const item = itemDef(String(itemId));
  if (!item) return { error: { status: 404, code: "UNKNOWN_ITEM", message: "没有这个商品" } };
  const { kind, def } = item;
  const out = db.transaction(() => {
    if (ownedItemIds(userId, db).has(def.id)) return { error: { status: 409, code: "ALREADY_OWNED", message: "你已经拥有它了" } };
    const balance = getJiuCoinBalance(userId, db);
    if (balance < def.price) {
      return { error: { status: 402, code: "INSUFFICIENT_FUNDS", message: "韭币不足", details: { balance, required: def.price } } };
    }
    const after = balance - def.price;
    db.prepare(`INSERT INTO user_cosmetics (user_id, item_id, kind, price) VALUES (?, ?, ?, ?)`).run(userId, def.id, kind, def.price);
    insertJiuCoinLedger(db, {
      userId,
      delta: -def.price,
      balanceAfter: after,
      reason: "cosmetic_purchase",
      refType: "cosmetic",
      refId: `${userId}:${def.id}`,
      meta: { item: def.id, kind },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(after, userId);
    return { ok: true };
  })();
  if (out.error) return { ...out, error: { ...out.error, details: out.error.details || getCosmeticState(userId, { db }) } };
  return { status: 200, data: { bought: def.id, kind, state: getCosmeticState(userId, { db }) } };
}

/** id null/"" = no entrance effect. */
export function equipEntrance(userId, id) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const want = id == null || id === "" ? null : String(id);
  if (want !== null) {
    if (!entranceDef(want)) return { error: { status: 404, code: "UNKNOWN_ITEM", message: "没有这个出场特效" } };
    if (!ownedItemIds(userId, db).has(want)) return { error: { status: 403, code: "NOT_OWNED", message: "你还没有这个出场特效" } };
  }
  db.prepare(`UPDATE users SET pvp_entrance = ?, updated_at = datetime('now') WHERE id = ?`).run(want, userId);
  return { status: 200, data: { equipped: want, state: getCosmeticState(userId, { db }) } };
}
