import { getJiuCoinBalance, shanghaiYmd } from "../jiuCoin.js";
import {
  MIN_ACCOUNT_AGE_MS,
  MIN_CLASSIC_GAMES,
  PAIR_WINDOW_MS,
  SYSTEM_VOID_REASONS,
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

export function classicSettledCount(db, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM game_results r
       JOIN game_sessions s ON s.id = r.game_id
       WHERE s.user_id = ?
         AND s.game_kind = 'classic'
         AND s.status = 'settled'
         AND r.validity = 'valid'`
    )
    .get(userId);
  return Number(row.c) || 0;
}

export function rewardCount(db, userId, ymd) {
  const row = db
    .prepare(`SELECT win_reward_count AS c FROM pvp_reward_days WHERE user_id = ? AND ymd = ?`)
    .get(userId, ymd);
  return row ? Number(row.c) : 0;
}

export function startedPairCount(db, key, now, windowMs = PAIR_WINDOW_MS) {
  const reasons = [...SYSTEM_VOID_REASONS];
  const placeholders = reasons.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM pvp_matches m
       JOIN pvp_challenges c ON c.id = m.challenge_id
       WHERE c.pair_key = ?
         AND m.started_at IS NOT NULL
         AND m.started_at >= ?
         AND COALESCE(m.terminal_reason, '') NOT IN (${placeholders})`
    )
    .get(key, now - windowMs, ...reasons);
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
export function assessEntry(db, userIdA, userIdB, now, economy = currentEconomy(now)) {
  if (isBlocked(db, userIdA, userIdB)) {
    return denial("BLOCKED", "双方无法约战", 403);
  }
  const ymd = shanghaiYmd(new Date(now));
  for (const userId of [userIdA, userIdB]) {
    const user = db.prepare(`SELECT id, status, created_at FROM users WHERE id = ?`).get(userId);
    if (!user || user.status !== "active") {
      return denial("NOT_ELIGIBLE", "账号当前不能参加对战", 403);
    }
    if (now - sqliteUtcMs(user.created_at) < MIN_ACCOUNT_AGE_MS) {
      return denial("NOT_ELIGIBLE", "注册满 24 小时后才能参加对战", 403);
    }
    if (classicSettledCount(db, userId) < MIN_CLASSIC_GAMES) {
      return denial("NOT_ELIGIBLE", "完成至少 3 局经典练习后才能参加对战", 403);
    }
    if (getJiuCoinBalance(userId, db) < economy.entryCost) {
      return denial("INSUFFICIENT_FUNDS", "韭币不足，无法开始对战", 402);
    }
    if (rewardCount(db, userId, ymd) >= economy.dailyRewardCap) {
      return denial("REWARD_CAP", "今日胜场奖励次数已用完", 403);
    }
  }
  const used = startedPairCount(db, pairKey(userIdA, userIdB), now);
  if (used >= economy.pairLimit24h) {
    return denial("PAIR_LIMIT", "24 小时内与该对手的对战已达上限", 403);
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
