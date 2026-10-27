import { getJiuCoinBalance, shanghaiYmd } from "../jiuCoin.js";
import {
  MIN_CLASSIC_GAMES,
  currentEconomy,
} from "./config.js";

export function pairKey(userA, userB) {
  const a = Number(userA);
  const b = Number(userB);
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** SQLite datetime('now') has no zone. ISO strings with Z parse as UTC. */
export function sqliteUtcMs(text) {
  if (text == null) return NaN;
  const raw = String(text);
  if (raw.includes("T")) return Date.parse(raw);
  return Date.parse(`${raw.replace(" ", "T")}Z`);
}

function denial(code, message, status) {
  return { ok: false, code, message, status };
}

/**
 * Practice games that unlock 对战: finished (settled, valid) 经典练习 and 韭币局. 「开一局」 starts a 韭币局 when
 * that mode is live, so a newbie's first games are stake games; abandoned / forfeited ones never reach 'settled'.
 */
export function classicSettledCount(db, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM game_results r
       JOIN game_sessions s ON s.id = r.game_id
       WHERE s.user_id = ?
         AND s.game_kind IN ('classic', 'stake')
         AND s.status = 'settled'
         AND r.validity = 'valid'`
    )
    .get(userId);
  return Number(row.c) || 0;
}

export function isBlocked(db, userA, userB) {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM pvp_blocks
       WHERE (blocker_user_id = ? AND blocked_user_id = ?)
          OR (blocker_user_id = ? AND blocked_user_id = ?)`
    )
    .get(userA, userB, userB, userA);
  return !!row;
}

/**
 * Both players must pass. The result does not say which player failed,
 * and it does not include a balance.
 * IP is intentionally not an input.
 */
export function assessSelf(db, userId, now, economy = currentEconomy(now)) {
  const user = db.prepare(`SELECT id, status, created_at FROM users WHERE id = ?`).get(userId);
  if (!user || user.status !== "active") {
    return denial("NOT_ELIGIBLE", "账号当前不能参加对战", 403);
  }
  if (classicSettledCount(db, userId) < MIN_CLASSIC_GAMES) {
    return denial("NOT_ELIGIBLE", "完成至少 3 局练习（经典练习或韭币局）后才能参加对战", 403);
  }
  const balance = getJiuCoinBalance(userId, db);
  if (balance < economy.entryCost) {
    return denial("INSUFFICIENT_FUNDS", "韭币不足，无法开始对战", 402);
  }
  return { ok: true, balance, rewardYmd: shanghaiYmd(new Date(now)) };
}

export function assessEntry(db, userIdA, userIdB, now, economy = currentEconomy(now)) {
  if (isBlocked(db, userIdA, userIdB)) {
    return denial("BLOCKED", "双方无法约战", 403);
  }
  const ymd = shanghaiYmd(new Date(now));
  for (const userId of [userIdA, userIdB]) {
    const user = db.prepare(`SELECT id, status, created_at, is_bot FROM users WHERE id = ?`).get(userId);
    if (!user || user.status !== "active") {
      return denial("NOT_ELIGIBLE", "账号当前不能参加对战", 403);
    }
    // Companion bots skip the classic-practice gate; they still need entry balance.
    if (Number(user.is_bot) !== 1 && classicSettledCount(db, userId) < MIN_CLASSIC_GAMES) {
      return denial("NOT_ELIGIBLE", "完成至少 3 局练习（经典练习或韭币局）后才能参加对战", 403);
    }
    if (getJiuCoinBalance(userId, db) < economy.entryCost) {
      return denial("INSUFFICIENT_FUNDS", "韭币不足，无法开始对战", 402);
    }
  }
  return { ok: true, rewardYmd: ymd };
}

export function blockUser(db, blockerId, blockedId, now) {
  if (Number(blockerId) === Number(blockedId)) {
    return denial("SELF_BLOCK", "不能屏蔽自己", 422);
  }
  db.prepare(
    `INSERT OR IGNORE INTO pvp_blocks (blocker_user_id, blocked_user_id, created_at)
     VALUES (?, ?, ?)`
  ).run(blockerId, blockedId, now);
  return { ok: true };
}
