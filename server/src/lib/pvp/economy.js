import { getJiuCoinBalance, insertJiuCoinLedger } from "../jiuCoin.js";

function fail(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Deduct one player's entry inside the caller's transaction.
 * The conditional update is the balance check. The partial unique index
 * rejects a second entry for the same user and match.
 */
export function chargePvpEntry(db, { userId, matchId, cost, economyVersion }) {
  if (!Number.isInteger(cost) || cost <= 0) {
    throw fail("BAD_ECONOMY", "入场费无效", 500);
  }
  const info = db
    .prepare(
      `UPDATE users
       SET jiu_coin_balance = jiu_coin_balance - ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'active' AND jiu_coin_balance >= ?`
    )
    .run(cost, userId, cost);
  if (info.changes !== 1) {
    throw fail("INSUFFICIENT_FUNDS", "韭币不足，无法开始对战", 402);
  }
  const balanceAfter = getJiuCoinBalance(userId, db);
  insertJiuCoinLedger(db, {
    userId,
    delta: -cost,
    balanceAfter,
    reason: "pvp_entry",
    refType: "pvp_match",
    refId: String(matchId),
    meta: { economyVersion },
  });
  return { balance: balanceAfter, charged: cost };
}

/** Winner reward or entry refund. amount 0 writes nothing. */
export function payPvp(db, { userId, matchId, amount, reason, economyVersion }) {
  if (reason !== "pvp_reward" && reason !== "pvp_refund") {
    throw fail("BAD_ECONOMY", "未知的对战入账原因", 500);
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw fail("BAD_ECONOMY", "入账金额无效", 500);
  }
  if (amount === 0) return { balance: getJiuCoinBalance(userId, db), amount: 0 };
  const info = db
    .prepare(
      `UPDATE users
       SET jiu_coin_balance = jiu_coin_balance + ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(amount, userId);
  if (info.changes !== 1) throw fail("BAD_ECONOMY", "入账用户不存在", 500);
  const balanceAfter = getJiuCoinBalance(userId, db);
  insertJiuCoinLedger(db, {
    userId,
    delta: amount,
    balanceAfter,
    reason,
    refType: "pvp_match",
    refId: String(matchId),
    meta: { economyVersion },
  });
  return { balance: balanceAfter, amount };
}

export function entryCharge(db, userId, matchId) {
  const row = db
    .prepare(
      `SELECT delta FROM jiu_coin_ledger
       WHERE user_id = ? AND ref_type = 'pvp_match' AND ref_id = ? AND reason = 'pvp_entry'`
    )
    .get(userId, String(matchId));
  return row ? Math.abs(Number(row.delta)) : 0;
}
