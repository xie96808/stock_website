/**
 * 付费复盘 — per-game unlocks bought with 韭币 (a sink).
 *   route  最优路线重演 (30): the true optimal action sequence for the window + hindsight reasons + a summary
 *   hold   死拿对照 (+10, needs route): the buy-and-hold curve
 * The free preview (teaser) shows only the two headline numbers. Everything is computed from the stored window and the
 * settled actions by shared/reviewEngine.js; nothing about settlement changes.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";
import { windowFromSessionRow } from "./gameWindowDto.js";
import { getChallengeById } from "./dailyChallenge.js";
import { buildReview, reviewTeaser } from "../../../shared/reviewEngine.js";
import { oneshotLimits } from "../../../shared/oneshot.js";
import { GAME_KIND_CLASSIC, GAME_KIND_ONESHOT, GAME_KIND_DAILY } from "../../../shared/protocol.js";
import { GAME_DAYS, DECISION_DAYS } from "../../../shared/rules.js";

export const REVIEW_PRODUCTS = Object.freeze({
  route: Object.freeze({ id: "route", name: "最优路线重演", price: 30, desc: "同一段行情重走一遍，走到最优买卖点自动停下告诉你为什么" }),
  hold: Object.freeze({ id: "hold", name: "死拿对照", price: 10, desc: "加看一直拿着不动的收益走势" }),
});

export function gameReviewEnabled() {
  return !!config.gameReviewEnabled;
}

function guardUser(db, userId) {
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能操作" } };
  }
  return null;
}

function ownedProducts(db, gameId) {
  const rows = db.prepare(`SELECT product FROM game_reviews WHERE game_id = ?`).all(gameId);
  const set = new Set(rows.map((r) => r.product));
  return { route: set.has("route"), hold: set.has("hold") };
}

/** @returns {{ error } | { row, result, actions, win, maxBuys }} */
export function loadReviewable(db, userId, gameId, { now = Date.now() } = {}) {
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(String(gameId || ""));
  if (!row || row.user_id !== userId) return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  if (row.status !== "settled") return { error: { status: 409, code: "NOT_SETTLED", message: "对局还没结算" } };
  const kind = row.game_kind || GAME_KIND_CLASSIC;
  if (![GAME_KIND_CLASSIC, GAME_KIND_ONESHOT, GAME_KIND_DAILY].includes(kind)) {
    return { error: { status: 422, code: "REVIEW_UNSUPPORTED", message: "这个玩法暂不支持复盘" } };
  }
  if (kind === GAME_KIND_DAILY) {
    // The daily window is shared: only open it for review once the day's ranking has closed.
    const ch = row.challenge_id ? getChallengeById(row.challenge_id, db) : null;
    if (!ch || Date.parse(ch.closes_at) > now) {
      return { error: { status: 422, code: "REVIEW_NOT_YET", message: "每日挑战结束后（次日 0 点）才能复盘" } };
    }
  }
  const result = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(row.id);
  if (!result) return { error: { status: 409, code: "NOT_SETTLED", message: "对局还没结算" } };
  let actions;
  try { actions = JSON.parse(result.actions_json); } catch { actions = null; }
  const win = windowFromSessionRow(row);
  if (!Array.isArray(actions) || actions.length !== DECISION_DAYS || !win || win.bars.length !== GAME_DAYS) {
    return { error: { status: 422, code: "REVIEW_UNSUPPORTED", message: "这局的数据不完整，无法复盘" } };
  }
  const maxBuys = kind === GAME_KIND_ONESHOT ? oneshotLimits(row.modifiers).maxBuys : Infinity;
  return { row, result, actions, win, maxBuys };
}

/** 「我的战绩」列表：给每局标出能不能复盘、买过哪些（功能关闭时原样返回）。 */
export function annotateReviews(userId, items) {
  if (!gameReviewEnabled() || !Array.isArray(items) || !items.length) return items;
  const db = openDb();
  const ids = items.map((g) => g.gameId).filter(Boolean);
  const owned = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = db
      .prepare(`SELECT game_id, product FROM game_reviews WHERE user_id = ? AND game_id IN (${chunk.map(() => "?").join(",")})`)
      .all(userId, ...chunk);
    for (const r of rows) {
      const o = owned.get(r.game_id) || { route: false, hold: false };
      o[r.product] = true;
      owned.set(r.game_id, o);
    }
  }
  const supportedKinds = new Set([GAME_KIND_CLASSIC, GAME_KIND_ONESHOT, GAME_KIND_DAILY]);
  return items.map((g) => ({
    ...g,
    review: {
      supported: supportedKinds.has(g.gameKind || GAME_KIND_CLASSIC),
      owned: owned.get(g.gameId) || { route: false, hold: false },
    },
  }));
}

function productList(owned, balance) {
  return Object.values(REVIEW_PRODUCTS).map((p) => ({
    id: p.id,
    name: p.name,
    desc: p.desc,
    price: p.price,
    owned: owned[p.id],
    buyable: !owned[p.id] && (p.id === "route" || owned.route),
    affordable: balance >= p.price,
  }));
}

export function getReviewState(userId, gameId, { db = openDb(), now = Date.now() } = {}) {
  if (!gameReviewEnabled()) return { status: 200, data: { enabled: false } };
  const loaded = loadReviewable(db, userId, gameId, { now });
  const balance = getJiuCoinBalance(userId, db);
  if (loaded.error) {
    // Unsupported / not yet / not settled are normal states for the client to explain, not failures.
    if (["REVIEW_UNSUPPORTED", "REVIEW_NOT_YET", "NOT_SETTLED"].includes(loaded.error.code)) {
      return { status: 200, data: { enabled: true, eligible: false, reason: loaded.error.code, message: loaded.error.message, balance } };
    }
    return loaded;
  }
  const { row, actions, win, maxBuys } = loaded;
  const owned = ownedProducts(db, row.id);
  const data = { enabled: true, eligible: true, gameId: row.id, balance, owned, products: productList(owned, balance) };
  const input = { fillMode: row.fill_mode, bars: win.bars, actions, maxBuys };
  if (!owned.route) {
    data.teaser = reviewTeaser(input);
  } else {
    const review = buildReview(input);
    if (!owned.hold) review.hold = null; // the death-hold curve is its own purchase
    data.review = review;
    data.window = { historyLength: win.historyLength, history: win.history, bars: win.bars };
    data.stock = { code: row.stock_code, name: row.stock_name };
  }
  return { status: 200, data };
}

export function buyReview(userId, gameId, product, { now = Date.now() } = {}) {
  const db = openDb();
  if (!gameReviewEnabled()) return { error: { status: 403, code: "FEATURE_DISABLED", message: "复盘暂未开放" } };
  const g = guardUser(db, userId);
  if (g) return g;
  const def = REVIEW_PRODUCTS[String(product)];
  if (!def) return { error: { status: 404, code: "UNKNOWN_PRODUCT", message: "没有这个商品" } };
  const loaded = loadReviewable(db, userId, gameId, { now });
  if (loaded.error) return loaded;
  const out = db.transaction(() => {
    const owned = ownedProducts(db, loaded.row.id);
    if (owned[def.id]) return { error: { status: 409, code: "ALREADY_UNLOCKED", message: "这局已经解锁过了" } };
    if (def.id === "hold" && !owned.route) return { error: { status: 409, code: "NEED_ROUTE", message: "先解锁最优路线重演" } };
    const balance = getJiuCoinBalance(userId, db);
    if (balance < def.price) {
      return { error: { status: 402, code: "INSUFFICIENT_FUNDS", message: "韭币不足", details: { balance, required: def.price } } };
    }
    const after = balance - def.price;
    db.prepare(`INSERT INTO game_reviews (game_id, user_id, product, price) VALUES (?, ?, ?, ?)`).run(loaded.row.id, userId, def.id, def.price);
    insertJiuCoinLedger(db, {
      userId,
      delta: -def.price,
      balanceAfter: after,
      reason: "review_purchase",
      refType: "game",
      refId: `${loaded.row.id}:${def.id}`,
      meta: { product: def.id },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(after, userId);
    return { ok: true };
  })();
  if (out.error) return out;
  return { status: 200, data: { bought: def.id, ...getReviewState(userId, gameId, { db, now }).data } };
}
