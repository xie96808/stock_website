/**
 * B0-PR3 / B05 — reward_claims scaffolding (PRD §6.3).
 *
 * Same-transaction grant/deduct + claim insert; idempotent on (user_id, reward_key).
 * Callers MUST supply server-authored amounts (never trust client).
 * Existing register / daily_claim / game_create paths stay on their own indexes.
 * Future F11 / F02 / F03 should call these helpers inside their business TX.
 */
import { openDb } from "../db/connection.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

/** Snapshotted economy ruleset id stored on each claim. Bump when config table changes. */
export const ECONOMY_VERSION = "economy-v1";

function assertServerAmount(amount) {
  // Strict: typeof number + Integer — reject string/float coercion from clients.
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    const err = new Error("reward amount must be a positive integer (server-authored)");
    err.code = "INVALID_REWARD_AMOUNT";
    throw err;
  }
  return amount;
}

function assertRewardKey(rewardKey) {
  if (typeof rewardKey !== "string" || rewardKey.trim().length < 1 || rewardKey.length > 200) {
    const err = new Error("reward_key must be a non-empty string (max 200)");
    err.code = "INVALID_REWARD_KEY";
    throw err;
  }
  return rewardKey.trim();
}

function assertReason(reason) {
  if (typeof reason !== "string" || reason.trim().length < 1 || reason.length > 64) {
    const err = new Error("ledger reason required (max 64)");
    err.code = "INVALID_REWARD_REASON";
    throw err;
  }
  return reason.trim();
}

function isUniqueViolation(e) {
  return String(e?.message || "").includes("UNIQUE");
}

function rowToClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    rewardKey: row.reward_key,
    amount: Number(row.amount),
    economyVersion: row.economy_version,
    ruleVersion: row.rule_version ?? null,
    ledgerId: row.ledger_id,
    createdAt: row.created_at,
  };
}

export function getRewardClaim(userId, rewardKey, db = openDb()) {
  const key = assertRewardKey(rewardKey);
  const row = db
    .prepare(
      `SELECT id, user_id, reward_key, amount, economy_version, rule_version, ledger_id, created_at
       FROM reward_claims WHERE user_id = ? AND reward_key = ?`
    )
    .get(userId, key);
  return rowToClaim(row);
}

export function hasRewardClaim(userId, rewardKey, db = openDb()) {
  return getRewardClaim(userId, rewardKey, db) != null;
}

function updateBalance(db, userId, balanceAfter) {
  db.prepare(
    `UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(balanceAfter, userId);
}

function insertClaim(db, { userId, rewardKey, amount, economyVersion, ruleVersion, ledgerId }) {
  const info = db
    .prepare(
      `INSERT INTO reward_claims (
        user_id, reward_key, amount, economy_version, rule_version, ledger_id
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, rewardKey, amount, economyVersion, ruleVersion, ledgerId);
  return Number(info.lastInsertRowid);
}

function unchangedResult(userId, rewardKey, db) {
  const claim = getRewardClaim(userId, rewardKey, db);
  return {
    unchanged: true,
    balance: getJiuCoinBalance(userId, db),
    claim,
    ledgerId: claim?.ledgerId ?? null,
  };
}

/**
 * Grant coins and insert reward_claims in one transaction (or savepoint if nested).
 * Idempotent: prior claim → { unchanged:true } without mutating balance.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.rewardKey e.g. quiz:2026-09-11, puzzle:first-clear:<familyId>
 * @param {number} opts.amount positive integer — server config only
 * @param {string} opts.reason ledger reason (quiz_daily_reward, puzzle_first_clear, …)
 * @param {string} [opts.economyVersion]
 * @param {string|null} [opts.ruleVersion]
 * @param {string|null} [opts.refType]
 * @param {string|null} [opts.refId]
 * @param {object|null} [opts.meta]
 */
export function grantRewardClaim(db, opts) {
  const userId = opts.userId;
  const rewardKey = assertRewardKey(opts.rewardKey);
  const amount = assertServerAmount(opts.amount);
  const reason = assertReason(opts.reason);
  const economyVersion = opts.economyVersion || ECONOMY_VERSION;
  const ruleVersion = opts.ruleVersion ?? null;
  const refType = opts.refType ?? null;
  const refId = opts.refId != null ? String(opts.refId) : null;
  const meta = opts.meta ?? null;

  const run = db.transaction(() => {
    const existing = getRewardClaim(userId, rewardKey, db);
    if (existing) {
      return {
        unchanged: true,
        balance: getJiuCoinBalance(userId, db),
        claim: existing,
        ledgerId: existing.ledgerId,
      };
    }

    const cur = getJiuCoinBalance(userId, db);
    const balanceAfter = cur + amount;
    const ledgerId = insertJiuCoinLedger(db, {
      userId,
      delta: amount,
      balanceAfter,
      reason,
      refType,
      refId,
      meta:
        meta != null
          ? { ...meta, rewardKey, economyVersion, ruleVersion }
          : { rewardKey, economyVersion, ruleVersion },
    });
    updateBalance(db, userId, balanceAfter);
    insertClaim(db, {
      userId,
      rewardKey,
      amount,
      economyVersion,
      ruleVersion,
      ledgerId,
    });
    return {
      unchanged: false,
      balance: balanceAfter,
      claim: getRewardClaim(userId, rewardKey, db),
      ledgerId,
    };
  });

  try {
    return run();
  } catch (e) {
    // UNIQUE on claim → whole TX rolled back; surface as idempotent hit.
    if (isUniqueViolation(e) && hasRewardClaim(userId, rewardKey, db)) {
      return unchangedResult(userId, rewardKey, db);
    }
    throw e;
  }
}

/**
 * Deduct coins and insert reward_claims in one transaction (e.g. rewind, cosmetic).
 * Idempotent on reward_key: prior claim returns unchanged without a second deduct.
 * Throws Error with .code = INSUFFICIENT_FUNDS when balance too low on first attempt.
 */
export function deductRewardClaim(db, opts) {
  const userId = opts.userId;
  const rewardKey = assertRewardKey(opts.rewardKey);
  const amount = assertServerAmount(opts.amount);
  const reason = assertReason(opts.reason);
  const economyVersion = opts.economyVersion || ECONOMY_VERSION;
  const ruleVersion = opts.ruleVersion ?? null;
  const refType = opts.refType ?? null;
  const refId = opts.refId != null ? String(opts.refId) : null;
  const meta = opts.meta ?? null;

  const run = db.transaction(() => {
    const existing = getRewardClaim(userId, rewardKey, db);
    if (existing) {
      return {
        unchanged: true,
        balance: getJiuCoinBalance(userId, db),
        claim: existing,
        ledgerId: existing.ledgerId,
      };
    }

    const cur = getJiuCoinBalance(userId, db);
    if (cur < amount) {
      const err = new Error("韭币不足");
      err.code = "INSUFFICIENT_FUNDS";
      err.balance = cur;
      err.required = amount;
      throw err;
    }
    const balanceAfter = cur - amount;
    const ledgerId = insertJiuCoinLedger(db, {
      userId,
      delta: -amount,
      balanceAfter,
      reason,
      refType,
      refId,
      meta:
        meta != null
          ? { ...meta, rewardKey, economyVersion, ruleVersion }
          : { rewardKey, economyVersion, ruleVersion },
    });
    updateBalance(db, userId, balanceAfter);
    insertClaim(db, {
      userId,
      rewardKey,
      amount,
      economyVersion,
      ruleVersion,
      ledgerId,
    });
    return {
      unchanged: false,
      balance: balanceAfter,
      claim: getRewardClaim(userId, rewardKey, db),
      ledgerId,
    };
  });

  try {
    return run();
  } catch (e) {
    if (e.code === "INSUFFICIENT_FUNDS") throw e;
    if (isUniqueViolation(e) && hasRewardClaim(userId, rewardKey, db)) {
      return unchangedResult(userId, rewardKey, db);
    }
    throw e;
  }
}
