/**
 * 改名卡 — changing a nickname spends one (only while `renameCardEnabled` is on). Cards are bought with 韭币, a pure sink.
 * Registration and every other profile field stay free. Admins and bots never need one. Each rename is logged in
 * `nickname_changes` so an impersonation can be traced.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

export const RENAME_CARD_PRICE = 300;

export function renameCardEnabled() {
  return !!config.renameCardEnabled;
}

export function renameCardCount(userId, db = openDb()) {
  return Number(db.prepare(`SELECT rename_cards AS n FROM users WHERE id = ?`).get(userId)?.n) || 0;
}

export function getRenameState(userId, { db = openDb() } = {}) {
  const row = db.prepare(`SELECT nickname FROM users WHERE id = ?`).get(userId);
  return {
    enabled: renameCardEnabled(),
    price: RENAME_CARD_PRICE,
    cards: renameCardCount(userId, db),
    balance: getJiuCoinBalance(userId, db),
    nickname: row?.nickname || "",
  };
}

function guard(db, userId) {
  if (!renameCardEnabled()) return { error: { status: 404, code: "FEATURE_DISABLED", message: "改名卡暂未开放" } };
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能操作" } };
  }
  return null;
}

export function buyRenameCard(userId) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  const out = db.transaction(() => {
    const balance = getJiuCoinBalance(userId, db);
    if (balance < RENAME_CARD_PRICE) {
      return { error: { status: 402, code: "INSUFFICIENT_FUNDS", message: "韭币不足", details: { balance, required: RENAME_CARD_PRICE } } };
    }
    const bought = Number(
      db.prepare(`SELECT COUNT(*) AS n FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'rename_card_purchase'`).get(userId).n
    );
    const after = balance - RENAME_CARD_PRICE;
    insertJiuCoinLedger(db, {
      userId,
      delta: -RENAME_CARD_PRICE,
      balanceAfter: after,
      reason: "rename_card_purchase",
      refType: "rename_card",
      refId: `${userId}:${bought + 1}`,
      meta: { n: bought + 1 },
    });
    db.prepare(`UPDATE users SET jiu_coin_balance = ?, rename_cards = rename_cards + 1, updated_at = datetime('now') WHERE id = ?`).run(after, userId);
    return { ok: true };
  })();
  if (out.error) return out;
  return { status: 200, data: { state: getRenameState(userId, { db }) } };
}

/**
 * Called by PATCH /me inside the same transaction as the profile update when the nickname really changes.
 * @returns {null | {error}} null = allowed (a card was spent, or none is needed).
 */
export function spendRenameCard(userId, oldNickname, newNickname, db = openDb()) {
  if (!renameCardEnabled()) return null;
  const u = db.prepare(`SELECT role, is_bot FROM users WHERE id = ?`).get(userId);
  const free = !u || u.role === "admin" || Number(u.is_bot) === 1;
  if (!free) {
    const spent = db.prepare(`UPDATE users SET rename_cards = rename_cards - 1 WHERE id = ? AND rename_cards >= 1`).run(userId);
    if (spent.changes !== 1) {
      return { error: { status: 402, code: "RENAME_CARD_REQUIRED", message: "改昵称需要一张改名卡，去韭菜商店购买", details: { price: RENAME_CARD_PRICE } } };
    }
  }
  db.prepare(`INSERT INTO nickname_changes (user_id, old_nickname, new_nickname, used_card) VALUES (?, ?, ?, ?)`).run(userId, oldNickname, newNickname, free ? 0 : 1);
  return null;
}
