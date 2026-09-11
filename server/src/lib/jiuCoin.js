import { openDb } from "../db/connection.js";
import { findUserById } from "./users.js";
import { writeAuditLog } from "./audit.js";

export const JIU_COIN_REGISTER_GRANT = 500;
export const JIU_COIN_GAME_CREATE_COST = 20;
export const JIU_COIN_GAME_REWIND_COST = 50;
export const JIU_COIN_DAILY_MIN = 50;
export const JIU_COIN_DAILY_MAX = 200;

/** Asia/Shanghai calendar date as YYYY-MM-DD. */
export function shanghaiYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getJiuCoinBalance(userId, db = openDb()) {
  const row = db.prepare(`SELECT jiu_coin_balance AS bal FROM users WHERE id = ?`).get(userId);
  return row ? Number(row.bal) || 0 : 0;
}

/** @returns {number} ledger row id */
export function insertJiuCoinLedger(db, { userId, delta, balanceAfter, reason, refType = null, refId = null, meta = null }) {
  const info = db
    .prepare(
      `INSERT INTO jiu_coin_ledger (
        user_id, delta, balance_after, reason, ref_type, ref_id, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      delta,
      balanceAfter,
      reason,
      refType,
      refId,
      meta != null ? JSON.stringify(meta) : null
    );
  return Number(info.lastInsertRowid);
}

const insertLedger = insertJiuCoinLedger;

/**
 * Grant register bonus inside an existing transaction (db required).
 * Idempotent via unique partial index on reason=register_grant.
 */
export function grantRegisterBonus(userId, db) {
  const cur = getJiuCoinBalance(userId, db);
  const next = cur + JIU_COIN_REGISTER_GRANT;
  try {
    insertLedger(db, {
      userId,
      delta: JIU_COIN_REGISTER_GRANT,
      balanceAfter: next,
      reason: "register_grant",
      refType: "user",
      refId: String(userId),
    });
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      return { unchanged: true, balance: getJiuCoinBalance(userId, db) };
    }
    throw e;
  }
  db.prepare(
    `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(next, userId);
  return { unchanged: false, balance: next };
}

/**
 * Deduct create cost in the same TX as game_sessions INSERT.
 * Throws Error with .code = INSUFFICIENT_FUNDS when balance too low.
 * Idempotent per game id (unique partial index).
 */
export function deductGameCreate(userId, gameId, db) {
  const existing = db
    .prepare(
      `SELECT id FROM jiu_coin_ledger
       WHERE reason = 'game_create' AND ref_type = 'game' AND ref_id = ?`
    )
    .get(String(gameId));
  if (existing) {
    return { unchanged: true, balance: getJiuCoinBalance(userId, db) };
  }

  const cur = getJiuCoinBalance(userId, db);
  if (cur < JIU_COIN_GAME_CREATE_COST) {
    const err = new Error("韭币不足，无法创建云端对局");
    err.code = "INSUFFICIENT_FUNDS";
    err.balance = cur;
    err.required = JIU_COIN_GAME_CREATE_COST;
    throw err;
  }
  const next = cur - JIU_COIN_GAME_CREATE_COST;
  insertLedger(db, {
    userId,
    delta: -JIU_COIN_GAME_CREATE_COST,
    balanceAfter: next,
    reason: "game_create",
    refType: "game",
    refId: String(gameId),
  });
  db.prepare(
    `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(next, userId);
  return { unchanged: false, balance: next };
}

export function dailyClaimStatus(userId, db = openDb()) {
  const today = shanghaiYmd();
  const row = db
    .prepare(
      `SELECT amount, created_at FROM jiu_coin_daily_claims
       WHERE user_id = ? AND claim_date = ?`
    )
    .get(userId, today);
  return {
    date: today,
    claimedToday: !!row,
    amount: row ? Number(row.amount) : null,
    claimedAt: row?.created_at || null,
    balance: getJiuCoinBalance(userId, db),
  };
}

/** Uniform random integer in [min, max] inclusive. */
export function randomDailyAmount(rng = Math.random) {
  const span = JIU_COIN_DAILY_MAX - JIU_COIN_DAILY_MIN + 1;
  return JIU_COIN_DAILY_MIN + Math.floor(rng() * span);
}

export function claimDaily(userId, { rng = Math.random } = {}) {
  const db = openDb();
  const today = shanghaiYmd();
  const existing = db
    .prepare(
      `SELECT amount, created_at FROM jiu_coin_daily_claims
       WHERE user_id = ? AND claim_date = ?`
    )
    .get(userId, today);
  if (existing) {
    return {
      error: {
        status: 409,
        code: "ALREADY_CLAIMED_TODAY",
        message: "今日已领取韭币",
        details: {
          date: today,
          amount: Number(existing.amount),
          balance: getJiuCoinBalance(userId, db),
        },
      },
    };
  }

  const amount = randomDailyAmount(rng);
  let balanceAfter;
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO jiu_coin_daily_claims (user_id, claim_date, amount) VALUES (?, ?, ?)`
      ).run(userId, today, amount);
      const cur = getJiuCoinBalance(userId, db);
      balanceAfter = cur + amount;
      insertLedger(db, {
        userId,
        delta: amount,
        balanceAfter,
        reason: "daily_claim",
        refType: "daily",
        refId: today,
        meta: { amount },
      });
      db.prepare(
        `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(balanceAfter, userId);
    });
    tx();
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      const again = dailyClaimStatus(userId, db);
      return {
        error: {
          status: 409,
          code: "ALREADY_CLAIMED_TODAY",
          message: "今日已领取韭币",
          details: {
            date: again.date,
            amount: again.amount,
            balance: again.balance,
          },
        },
      };
    }
    throw e;
  }

  return {
    status: 200,
    data: {
      date: today,
      amount,
      balance: balanceAfter,
      claimedToday: true,
    },
  };
}

/**
 * Admin adjust: op add | sub | set. Required reason. Audited.
 */
export function adminAdjustJiuCoin({
  actorId,
  targetUserId,
  op,
  amount,
  reason,
  requestId = null,
}) {
  if (typeof reason !== "string" || reason.trim().length < 2) {
    return { error: { status: 400, code: "REASON_REQUIRED", message: "必须填写原因（至少 2 个字）" } };
  }
  if (reason.trim().length > 500) {
    return { error: { status: 400, code: "REASON_REQUIRED", message: "原因过长" } };
  }
  if (op !== "add" && op !== "sub" && op !== "set") {
    return { error: { status: 400, code: "INVALID_OP", message: "op 须为 add / sub / set" } };
  }
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 0 || (op !== "set" && n === 0)) {
    return {
      error: {
        status: 400,
        code: "INVALID_AMOUNT",
        message: op === "set" ? "amount 须为非负整数" : "amount 须为正整数",
      },
    };
  }
  if (op === "set" && n > 1_000_000_000) {
    return { error: { status: 400, code: "INVALID_AMOUNT", message: "amount 过大" } };
  }

  const db = openDb();
  const target = findUserById(targetUserId);
  if (!target || target.status === "deleted") {
    return { error: { status: 404, code: "NOT_FOUND", message: "用户不存在" } };
  }

  const beforeBal = Number(target.jiu_coin_balance) || 0;
  let afterBal;
  if (op === "add") afterBal = beforeBal + n;
  else if (op === "sub") {
    if (beforeBal < n) {
      return {
        error: {
          status: 400,
          code: "INSUFFICIENT_FUNDS",
          message: "余额不足，无法扣减",
          details: { balance: beforeBal, required: n },
        },
      };
    }
    afterBal = beforeBal - n;
  } else afterBal = n;

  const delta = afterBal - beforeBal;
  if (delta === 0) {
    return {
      status: 200,
      data: {
        userId: targetUserId,
        balance: beforeBal,
        delta: 0,
        unchanged: true,
      },
    };
  }

  const tx = db.transaction(() => {
    insertLedger(db, {
      userId: targetUserId,
      delta,
      balanceAfter: afterBal,
      reason: "admin_adjust",
      refType: "admin",
      refId: String(actorId),
      meta: { op, amount: n },
    });
    db.prepare(
      `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(afterBal, targetUserId);
    writeAuditLog({
      actorId,
      action: `jiu_coin.${op}`,
      targetType: "user",
      targetId: String(targetUserId),
      reason: reason.trim(),
      before: { jiuCoinBalance: beforeBal },
      after: { jiuCoinBalance: afterBal },
      requestId,
    });
  });
  tx();

  return {
    status: 200,
    data: {
      userId: targetUserId,
      balance: afterBal,
      delta,
      op,
      amount: n,
    },
  };
}

/**
 * Idempotent backfill for active users (used by tests; migrate SQL is source of truth in prod).
 */
export function backfillActiveUsersOnce(db = openDb()) {
  const tx = db.transaction(() => {
    const rows = db
      .prepare(`SELECT id, jiu_coin_balance FROM users WHERE status = 'active'`)
      .all();
    let granted = 0;
    for (const row of rows) {
      const has = db
        .prepare(
          `SELECT 1 AS ok FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'backfill_grant'`
        )
        .get(row.id);
      if (has) continue;
      const next = (Number(row.jiu_coin_balance) || 0) + JIU_COIN_REGISTER_GRANT;
      insertLedger(db, {
        userId: row.id,
        delta: JIU_COIN_REGISTER_GRANT,
        balanceAfter: next,
        reason: "backfill_grant",
        refType: "migration",
        refId: "008_jiu_coin",
      });
      db.prepare(
        `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(next, row.id);
      granted += 1;
    }
    return granted;
  });
  return { granted: tx() };
}
