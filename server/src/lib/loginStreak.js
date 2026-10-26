/**
 * 连续登录奖励 — 7-day cycle, claimed by hand (one tap per Asia/Shanghai day).
 *
 * Rules (kept deliberately forgiving, and small: most players already hold 200+ 韭币, so this is a
 * return hook, not a faucet):
 *   - day 1..7 pays STREAK_COINS[day-1]; day 7 also grants STREAK_DAY7_SPINS bonus wheel spin(s).
 *   - claimed yesterday  → next day of the cycle (after day 7 the cycle restarts at day 1).
 *   - missed ≥ 1 day     → step BACK one tier (never a full reset): next = max(1, lastDay - 1); run counter restarts.
 * Claim is idempotent per (user, day): a double tap / stale tab gets 409 ALREADY_CLAIMED_TODAY.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { challengeNow, nextShanghaiYmd, shanghaiYmdAt } from "./dailyChallenge.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

export const STREAK_COINS = Object.freeze([20, 25, 30, 35, 40, 50, 60]);
export const STREAK_DAY7_SPINS = 1;
export const STREAK_CYCLE = STREAK_COINS.length;
/** Bonus spin stays usable this many days after it is granted (Shanghai dates). */
export const STREAK_SPIN_VALID_DAYS = 7;

function addDays(ymd, n) {
  let d = ymd;
  for (let i = 0; i < n; i++) d = nextShanghaiYmd(d);
  return d;
}

function prevYmd(ymd) {
  const ms = Date.parse(`${ymd}T12:00:00+08:00`) - 24 * 60 * 60 * 1000;
  return shanghaiYmdAt(new Date(ms));
}

/** Pure: what claiming `today` would do for a row (or null). */
export function planClaim(row, today) {
  const last = row?.last_claim_date || null;
  const pos = Number(row?.cycle_pos) || 0;
  const run = Number(row?.run_days) || 0;
  if (!last || pos === 0) return { claimable: true, day: 1, run: 1, wrapped: false, broken: false };
  if (last === today) return { claimable: false, claimedToday: true, day: pos, run };
  if (last === prevYmd(today)) {
    const wrapped = pos >= STREAK_CYCLE;
    return { claimable: true, day: wrapped ? 1 : pos + 1, run: run + 1, wrapped, broken: false };
  }
  return { claimable: true, day: Math.max(1, pos - 1), run: 1, wrapped: false, broken: true };
}

export function rewardFor(day) {
  const coins = STREAK_COINS[Math.min(Math.max(day, 1), STREAK_CYCLE) - 1];
  const spins = day === STREAK_CYCLE && config.luckyWheelEnabled ? STREAK_DAY7_SPINS : 0;
  return { coins, spins };
}

export function loginStreakEnabled() {
  return !!config.loginStreakEnabled;
}

function rowFor(db, userId) {
  return db.prepare(`SELECT * FROM login_streaks WHERE user_id = ?`).get(userId) || null;
}

export function getStreakState(userId, { now = challengeNow(), db = openDb() } = {}) {
  const today = shanghaiYmdAt(now);
  const row = rowFor(db, userId);
  const plan = planClaim(row, today);
  const claimedToday = !!plan.claimedToday;
  // The day that is (or was just) claimable, so the client can highlight it.
  const day = plan.day;
  return {
    enabled: loginStreakEnabled(),
    today,
    claimedToday,
    day,
    runDays: claimedToday ? plan.run : row ? (plan.broken ? 0 : Number(row.run_days) || 0) : 0,
    bestRun: Number(row?.best_run) || 0,
    cyclesDone: Number(row?.cycles_done) || 0,
    totalClaims: Number(row?.total_claims) || 0,
    broken: !!plan.broken,
    rewards: STREAK_COINS.map((coins, i) => ({ day: i + 1, coins, spins: rewardFor(i + 1).spins })),
    next: claimedToday ? null : rewardFor(day),
    balance: getJiuCoinBalance(userId, db),
  };
}

export function claimStreak(userId, { now = challengeNow() } = {}) {
  if (!loginStreakEnabled()) {
    return { error: { status: 404, code: "FEATURE_DISABLED", message: "连续登录奖励暂未开放" } };
  }
  const db = openDb();
  const u = db.prepare(`SELECT id, status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能领取" } };
  }
  const today = shanghaiYmdAt(now);
  let result;
  try {
    result = db.transaction(() => {
      const row = rowFor(db, userId);
      const plan = planClaim(row, today);
      if (!plan.claimable) return { already: true };
      const { coins, spins } = rewardFor(plan.day);
      db.prepare(
        `INSERT INTO login_streak_claims (user_id, claim_date, cycle_pos, run_days, coins, bonus_spins)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(userId, today, plan.day, plan.run, coins, spins);
      const balanceAfter = getJiuCoinBalance(userId, db) + coins;
      insertJiuCoinLedger(db, {
        userId,
        delta: coins,
        balanceAfter,
        reason: "streak_claim",
        refType: "streak",
        refId: `${userId}:${today}`,
        meta: { day: plan.day, run: plan.run, spins },
      });
      db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(balanceAfter, userId);
      if (spins > 0) {
        db.prepare(
          `INSERT INTO lucky_wheel_credit_grants (user_id, spins, source_key, reason, granted_by, expires_date)
           VALUES (?, ?, ?, ?, NULL, ?)`
        ).run(userId, spins, `streak:${userId}:${today}`, "连续登录第7天", addDays(today, STREAK_SPIN_VALID_DAYS));
      }
      const best = Math.max(Number(row?.best_run) || 0, plan.run);
      const cycles = (Number(row?.cycles_done) || 0) + (plan.day === STREAK_CYCLE ? 1 : 0);
      db.prepare(
        `INSERT INTO login_streaks (user_id, cycle_pos, run_days, best_run, cycles_done, total_claims, last_claim_date, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET cycle_pos = excluded.cycle_pos, run_days = excluded.run_days,
           best_run = excluded.best_run, cycles_done = excluded.cycles_done,
           total_claims = login_streaks.total_claims + 1, last_claim_date = excluded.last_claim_date,
           updated_at = excluded.updated_at`
      ).run(userId, plan.day, plan.run, best, cycles, today);
      return { day: plan.day, run: plan.run, coins, spins, broken: plan.broken, balance: balanceAfter };
    })();
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) result = { already: true };
    else throw e;
  }
  if (result.already) {
    return {
      error: {
        status: 409,
        code: "ALREADY_CLAIMED_TODAY",
        message: "今天已经领过了",
        details: getStreakState(userId, { now, db }),
      },
    };
  }
  return { status: 200, data: { claimed: result, state: getStreakState(userId, { now, db }) } };
}
