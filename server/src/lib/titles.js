/**
 * 称号 — bought with 韭币 (a sink), owned forever, one worn at a time. A title is shown next to the nickname on the
 * boards, in the PvP lobby and in a match. Equipping validates ownership at write time; every public DTO re-validates
 * the stored id against the code-side list (titleProp), so a retired title simply stops showing.
 */
import { openDb } from "../db/connection.js";
import { TITLES, titleDef } from "./titleDefs.js";
import { titleShopEnabled } from "./titleProp.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";

export { titleShopEnabled };

export function ownedTitleIds(userId, db = openDb()) {
  return new Set(db.prepare(`SELECT title_id FROM user_titles WHERE user_id = ?`).all(userId).map((r) => r.title_id));
}

function equippedOf(userId, db) {
  const raw = db.prepare(`SELECT title FROM users WHERE id = ?`).get(userId)?.title || null;
  return raw && titleDef(raw) ? raw : null;
}

/** Pure: shape one title for the client. */
export function shapeTitle(def, { owned, equipped, balance }) {
  return {
    id: def.id,
    name: def.name,
    desc: def.desc,
    tier: def.tier,
    price: def.price,
    owned: !!owned,
    equipped: !!equipped,
    buyable: !owned,
    affordable: !owned ? balance >= def.price : false,
  };
}

export function getTitleState(userId, { db = openDb() } = {}) {
  const owned = ownedTitleIds(userId, db);
  const equipped = equippedOf(userId, db);
  const balance = getJiuCoinBalance(userId, db);
  return {
    enabled: titleShopEnabled(),
    equipped,
    balance,
    titles: TITLES.map((t) => shapeTitle(t, { owned: owned.has(t.id), equipped: equipped === t.id, balance })),
  };
}

function guard(db, userId) {
  if (!titleShopEnabled()) {
    return { error: { status: 404, code: "FEATURE_DISABLED", message: "称号暂未开放" } };
  }
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能操作" } };
  }
  return null;
}

export function buyTitle(userId, titleId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const def = titleDef(String(titleId));
  if (!def) return { error: { status: 404, code: "UNKNOWN_TITLE", message: "没有这个称号" } };
  const out = db.transaction(() => {
    if (ownedTitleIds(userId, db).has(def.id)) return { error: { status: 409, code: "ALREADY_OWNED", message: "你已经拥有这个称号" } };
    const balance = getJiuCoinBalance(userId, db);
    if (balance < def.price) {
      return { error: { status: 402, code: "INSUFFICIENT_FUNDS", message: "韭币不足", details: { balance, required: def.price } } };
    }
    const after = balance - def.price;
    db.prepare(`INSERT INTO user_titles (user_id, title_id, price) VALUES (?, ?, ?)`).run(userId, def.id, def.price);
    insertJiuCoinLedger(db, {
      userId,
      delta: -def.price,
      balanceAfter: after,
      reason: "title_purchase",
      refType: "title",
      refId: `${userId}:${def.id}`,
      meta: { title: def.id },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(after, userId);
    return { ok: true };
  })();
  if (out.error) return { ...out, error: { ...out.error, details: out.error.details || getTitleState(userId, { db }) } };
  return { status: 200, data: { bought: def.id, state: getTitleState(userId, { db }) } };
}

/** titleId null/"" = take the title off. */
export function equipTitle(userId, titleId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const want = titleId == null || titleId === "" ? null : String(titleId);
  if (want !== null) {
    if (!titleDef(want)) return { error: { status: 404, code: "UNKNOWN_TITLE", message: "没有这个称号" } };
    if (!ownedTitleIds(userId, db).has(want)) {
      return { error: { status: 403, code: "NOT_OWNED", message: "你还没有这个称号" } };
    }
  }
  db.prepare(`UPDATE users SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(want, userId);
  invalidateLeaderboardCache();
  return { status: 200, data: { equipped: want, state: getTitleState(userId, { db }) } };
}
