/**
 * 成就 — progress is derived from live data (so existing players are credited for what they already did);
 * the player taps 领取 per achievement (or 全部领取) and gets the coins once. Claimed rows are the source of
 * truth for unlocks (`unlock_key`, e.g. an avatar frame that no shop sells).
 *
 * A metric is a pure read of existing tables; adding an achievement = one DEFS entry (+ a metric if new).
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { getJiuCoinBalance, insertJiuCoinLedger } from "./jiuCoin.js";

/** metric key → (db, userId) => number */
export const METRICS = Object.freeze({
  games: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM game_sessions s JOIN game_results r ON r.game_id = s.id
           WHERE s.user_id = ? AND s.status = 'settled' AND r.validity = 'valid'`, u),
  profitGames: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM game_sessions s JOIN game_results r ON r.game_id = s.id
           WHERE s.user_id = ? AND s.status = 'settled' AND r.validity = 'valid' AND r.trade_count >= 1 AND r.return_ppm > 0`, u),
  /** best single-game return in whole percent (a game needs at least one trade). */
  bestReturnPct: (db, u) => {
    const r = db
      .prepare(`SELECT MAX(r.return_ppm) AS v FROM game_sessions s JOIN game_results r ON r.game_id = s.id
                WHERE s.user_id = ? AND s.status = 'settled' AND r.validity = 'valid' AND r.trade_count >= 1`)
      .get(u);
    return Math.max(0, Math.floor((Number(r?.v) || 0) / 10000));
  },
  dailyDone: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM daily_challenge_attempts WHERE user_id = ? AND status = 'settled'`, u),
  streakCycles: (db, u) => n(db, `SELECT COALESCE(MAX(cycles_done), 0) AS v FROM login_streaks WHERE user_id = ?`, u),
  streakBest: (db, u) => n(db, `SELECT COALESCE(MAX(best_run), 0) AS v FROM login_streaks WHERE user_id = ?`, u),
  quizDays: (db, u) => n(db, `SELECT COUNT(*) AS v FROM quiz_attempts WHERE user_id = ? AND status = 'settled'`, u),
  pvpPlayed: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM pvp_match_players WHERE user_id = ? AND outcome IN ('win','loss','draw')`, u),
  pvpWins: (db, u) => n(db, `SELECT COUNT(*) AS v FROM pvp_match_players WHERE user_id = ? AND outcome = 'win'`, u),
  invites: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM invite_redemptions WHERE inviter_id = ? AND status = 'rewarded'`, u),
  puzzleLevels: (db, u) =>
    n(db, `SELECT COUNT(*) AS v FROM puzzle_progress WHERE user_id = ? AND best_stars >= 1`, u),
  wheelSpins: (db, u) => n(db, `SELECT COUNT(*) AS v FROM lucky_wheel_spins WHERE user_id = ?`, u),

  // ---- 高手 (skill) metrics: only count games that actually traded and were played without 悔棋 ----
  /** average return (whole %, floor, never below 0) across ≥ AVG_MIN_GAMES qualifying games; 0 until then. */
  avgReturnPct: (db, u) => {
    const r = db.prepare(`SELECT COUNT(*) AS c, AVG(r.return_ppm) AS a ${SKILL_FROM}`).get(u);
    if (!r || Number(r.c) < AVG_MIN_GAMES) return 0;
    return Math.max(0, Math.floor((Number(r.a) || 0) / 10000));
  },
  /** profitable games whose max drawdown stayed within 10% */
  ddProfit10: (db, u) => n(db, `SELECT COUNT(*) AS v ${SKILL_FROM} AND r.return_ppm > 0 AND r.mdd_ppm IS NOT NULL AND r.mdd_ppm <= 100000`, u),
  /** profitable games whose max drawdown stayed within 5% */
  ddProfit5: (db, u) => n(db, `SELECT COUNT(*) AS v ${SKILL_FROM} AND r.return_ppm > 0 AND r.mdd_ppm IS NOT NULL AND r.mdd_ppm <= 50000`, u),
  /** +20% or better with max drawdown within 5% */
  calmBigWins: (db, u) => n(db, `SELECT COUNT(*) AS v ${SKILL_FROM} AND r.return_ppm >= 200000 AND r.mdd_ppm IS NOT NULL AND r.mdd_ppm <= 50000`, u),
  /** profitable games that also beat the buy-and-hold benchmark of the same stock/window */
  beatBenchmark: (db, u) =>
    n(db, `SELECT COUNT(*) AS v ${SKILL_FROM} AND r.return_ppm > 0 AND r.benchmark_return_ppm IS NOT NULL AND r.return_ppm > r.benchmark_return_ppm`, u),
  /** longest run of consecutive profitable qualifying games (a loss or flat game resets it) */
  bestWinStreak: (db, u) => {
    const rows = db.prepare(`SELECT r.return_ppm AS p ${SKILL_FROM} ORDER BY r.created_at, r.game_id`).all(u);
    return bestRun(rows.map((r) => Number(r.p) > 0));
  },
});

/** qualifying game: settled, valid, at least one trade, no rewind. `AND …` clauses may be appended. */
const SKILL_FROM = `FROM game_sessions s JOIN game_results r ON r.game_id = s.id
  WHERE s.user_id = ? AND s.status = 'settled' AND r.validity = 'valid' AND r.trade_count >= 1
    AND COALESCE(r.assist_class, 'clean') <> 'undo'`;
export const AVG_MIN_GAMES = 10;

/** Pure: longest run of `true` in a list. */
export function bestRun(flags) {
  let best = 0;
  let cur = 0;
  for (const f of flags) {
    cur = f ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

function n(db, sql, userId) {
  return Number(db.prepare(sql).get(userId)?.v) || 0;
}

/**
 * `unlock` = reward that is not coins (keys are shared with the avatar-frame shop: `frame:<id>`).
 * Order inside a group is the display order. Habit / social tiers pay well above the per-day login income so that
 * staying (and bringing friends) is clearly worth it; see docs/achievements.md for the economy math.
 */
export const ACHIEVEMENTS = Object.freeze([
  { key: "games_1", group: "play", name: "初出茅庐", desc: "完成 1 局", metric: "games", target: 1, coins: 20 },
  { key: "games_10", group: "play", name: "常客", desc: "完成 10 局", metric: "games", target: 10, coins: 40 },
  { key: "games_50", group: "play", name: "老韭菜", desc: "完成 50 局", metric: "games", target: 50, coins: 120 },
  { key: "games_200", group: "play", name: "韭菜之王", desc: "完成 200 局", metric: "games", target: 200, coins: 400, unlock: "frame:crown" },
  { key: "profit_1", group: "profit", name: "开门红", desc: "盈利收官 1 局", metric: "profitGames", target: 1, coins: 30 },
  { key: "profit_10", group: "profit", name: "稳稳的幸福", desc: "盈利收官 10 局", metric: "profitGames", target: 10, coins: 100 },
  { key: "ret_20", group: "profit", name: "小有斩获", desc: "单局收益率达到 +20%", metric: "bestReturnPct", target: 20, coins: 80, unit: "%" },
  { key: "ret_50", group: "profit", name: "股神附体", desc: "单局收益率达到 +50%", metric: "bestReturnPct", target: 50, coins: 200, unit: "%", unlock: "frame:laurel" },
  // 高手: quality of play, not volume. Rewound (悔棋) and no-trade games never count.
  { key: "avg_2", group: "skill", name: "稳中求进", desc: "至少 10 局（有交易、未悔棋），平均收益率达到 +2%", metric: "avgReturnPct", target: 2, coins: 150, unit: "%" },
  { key: "avg_5", group: "skill", name: "复利之路", desc: "至少 10 局（有交易、未悔棋），平均收益率达到 +5%", metric: "avgReturnPct", target: 5, coins: 400, unit: "%" },
  { key: "avg_8", group: "skill", name: "长期主义", desc: "至少 10 局（有交易、未悔棋），平均收益率达到 +8%", metric: "avgReturnPct", target: 8, coins: 1000, unit: "%" },
  { key: "dd10_1", group: "skill", name: "控制回撤", desc: "盈利收官，且最大回撤不超过 10%", metric: "ddProfit10", target: 1, coins: 80 },
  { key: "dd5_1", group: "skill", name: "稳如泰山", desc: "盈利收官，且最大回撤不超过 5%", metric: "ddProfit5", target: 1, coins: 150 },
  { key: "dd5_10", group: "skill", name: "回撤克星", desc: "累计 10 局盈利收官且最大回撤不超过 5%", metric: "ddProfit5", target: 10, coins: 500 },
  { key: "calm_20", group: "skill", name: "进退有度", desc: "单局收益 +20% 以上，最大回撤不超过 5%", metric: "calmBigWins", target: 1, coins: 400 },
  { key: "beat_1", group: "skill", name: "跑赢死拿", desc: "盈利收官，且跑赢同一时段的买入持有", metric: "beatBenchmark", target: 1, coins: 60 },
  { key: "beat_10", group: "skill", name: "择时有道", desc: "累计 10 局盈利并跑赢买入持有", metric: "beatBenchmark", target: 10, coins: 250 },
  { key: "beat_30", group: "skill", name: "市场的对手", desc: "累计 30 局盈利并跑赢买入持有", metric: "beatBenchmark", target: 30, coins: 800 },
  { key: "wstreak_3", group: "skill", name: "三连红", desc: "连续 3 局盈利收官", metric: "bestWinStreak", target: 3, coins: 100 },
  { key: "wstreak_5", group: "skill", name: "五连红", desc: "连续 5 局盈利收官", metric: "bestWinStreak", target: 5, coins: 300 },
  { key: "wstreak_8", group: "skill", name: "常胜将军", desc: "连续 8 局盈利收官", metric: "bestWinStreak", target: 8, coins: 800 },
  { key: "daily_1", group: "mode", name: "同题竞技", desc: "完成 1 次每日挑战", metric: "dailyDone", target: 1, coins: 30 },
  { key: "daily_10", group: "mode", name: "挑战常客", desc: "完成 10 次每日挑战", metric: "dailyDone", target: 10, coins: 100 },
  { key: "puzzle_1", group: "mode", name: "残局初解", desc: "通关 1 个残局关卡", metric: "puzzleLevels", target: 1, coins: 40 },
  { key: "puzzle_10", group: "mode", name: "残局高手", desc: "通关 10 个残局关卡", metric: "puzzleLevels", target: 10, coins: 150 },
  { key: "pvp_1", group: "mode", name: "初次交手", desc: "完成 1 场双人对战", metric: "pvpPlayed", target: 1, coins: 30 },
  { key: "pvp_win_1", group: "mode", name: "旗开得胜", desc: "赢下 1 场双人对战", metric: "pvpWins", target: 1, coins: 60 },
  { key: "pvp_win_10", group: "mode", name: "擂台常胜", desc: "赢下 10 场双人对战", metric: "pvpWins", target: 10, coins: 250 },
  { key: "streak_3", group: "habit", name: "三天打卡", desc: "连续登录 3 天", metric: "streakBest", target: 3, coins: 60 },
  { key: "streak_7", group: "habit", name: "一周不断", desc: "连续登录 7 天", metric: "streakBest", target: 7, coins: 200 },
  { key: "streak_14", group: "habit", name: "双周坚守", desc: "连续登录 14 天", metric: "streakBest", target: 14, coins: 400 },
  { key: "streak_30", group: "habit", name: "月度常驻", desc: "连续登录 30 天", metric: "streakBest", target: 30, coins: 1000 },
  { key: "streak_100", group: "habit", name: "百日韭菜", desc: "连续登录 100 天", metric: "streakBest", target: 100, coins: 4000 },
  { key: "streak_cycle_3", group: "habit", name: "七日成瘾", desc: "集齐 3 轮 7 天签到循环（第 7 天的碎片）", metric: "streakCycles", target: 3, coins: 200, unlock: "frame:ink_ring" },
  { key: "quiz_1", group: "habit", name: "好学生", desc: "完成 1 次每日答题", metric: "quizDays", target: 1, coins: 20 },
  { key: "quiz_7", group: "habit", name: "学而时习", desc: "累计完成 7 次每日答题", metric: "quizDays", target: 7, coins: 80 },
  { key: "quiz_30", group: "habit", name: "博学多才", desc: "累计完成 30 次每日答题", metric: "quizDays", target: 30, coins: 400 },
  { key: "wheel_10", group: "habit", name: "转运达人", desc: "累计转动幸运转盘 10 次", metric: "wheelSpins", target: 10, coins: 50 },
  { key: "invite_1", group: "social", name: "拉人入伙", desc: "邀请 1 位好友完成首局", metric: "invites", target: 1, coins: 150 },
  { key: "invite_5", group: "social", name: "人脉不错", desc: "邀请 5 位好友完成首局", metric: "invites", target: 5, coins: 600 },
  { key: "invite_20", group: "social", name: "韭菜地主", desc: "邀请 20 位好友完成首局", metric: "invites", target: 20, coins: 2500 },
]);

export const GROUPS = Object.freeze([
  { id: "play", name: "出道" },
  { id: "profit", name: "战绩" },
  { id: "skill", name: "高手" },
  { id: "mode", name: "玩法" },
  { id: "habit", name: "日常" },
  { id: "social", name: "社交" },
]);

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function achievementsEnabled() {
  return !!config.achievementsEnabled;
}

/** Pure: shape one achievement for the client given a progress value and its claimed row. */
export function shapeItem(def, progress, claimedRow) {
  const p = Math.max(0, Math.floor(Number(progress) || 0));
  const done = p >= def.target;
  return {
    key: def.key,
    group: def.group,
    name: def.name,
    desc: def.desc,
    target: def.target,
    unit: def.unit || "",
    progress: Math.min(p, def.target),
    coins: def.coins,
    unlock: def.unlock || null,
    done,
    claimed: !!claimedRow,
    claimable: done && !claimedRow,
    claimedAt: claimedRow?.claimed_at || null,
  };
}

function metricValues(db, userId) {
  const out = {};
  for (const k of new Set(ACHIEVEMENTS.map((a) => a.metric))) out[k] = METRICS[k](db, userId);
  return out;
}

export function getAchievementState(userId, { db = openDb() } = {}) {
  const values = metricValues(db, userId);
  const claimed = new Map(
    db.prepare(`SELECT key, coins, unlock_key, claimed_at FROM user_achievements WHERE user_id = ?`).all(userId).map((r) => [r.key, r])
  );
  const items = ACHIEVEMENTS.map((a) => shapeItem(a, values[a.metric], claimed.get(a.key)));
  return {
    enabled: achievementsEnabled(),
    groups: GROUPS,
    items,
    summary: {
      total: items.length,
      claimed: items.filter((i) => i.claimed).length,
      claimable: items.filter((i) => i.claimable).length,
      claimableCoins: items.filter((i) => i.claimable).reduce((s, i) => s + i.coins, 0),
      earnedCoins: items.filter((i) => i.claimed).reduce((s, i) => s + i.coins, 0),
    },
    unlocks: items.filter((i) => i.claimed && i.unlock).map((i) => i.unlock),
    balance: getJiuCoinBalance(userId, db),
  };
}

/** Frame keys (and other unlocks) this user earned through achievements — consumed by the avatar-frame shop. */
export function getAchievementUnlocks(userId, db = openDb()) {
  return db
    .prepare(`SELECT unlock_key FROM user_achievements WHERE user_id = ? AND unlock_key IS NOT NULL`)
    .all(userId)
    .map((r) => r.unlock_key);
}

/** Claim inside an open transaction. @returns {{coins:number, unlock:string|null}|null} null when already claimed. */
function claimOne(db, userId, def) {
  const ins = db
    .prepare(`INSERT OR IGNORE INTO user_achievements (user_id, key, coins, unlock_key) VALUES (?, ?, ?, ?)`)
    .run(userId, def.key, def.coins, def.unlock || null);
  if (ins.changes !== 1) return null;
  const balanceAfter = getJiuCoinBalance(userId, db) + def.coins;
  insertJiuCoinLedger(db, {
    userId,
    delta: def.coins,
    balanceAfter,
    reason: "achievement_claim",
    refType: "achievement",
    refId: `${userId}:${def.key}`,
    meta: { key: def.key, unlock: def.unlock || null },
  });
  db.prepare(`UPDATE users SET jiu_coin_balance = ?, updated_at = datetime('now') WHERE id = ?`).run(balanceAfter, userId);
  return { coins: def.coins, unlock: def.unlock || null };
}

function guard(db, userId) {
  if (!achievementsEnabled()) {
    return { error: { status: 404, code: "FEATURE_DISABLED", message: "成就暂未开放" } };
  }
  const u = db.prepare(`SELECT status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status !== "active" || Number(u.is_bot) === 1) {
    return { error: { status: 403, code: "NOT_ALLOWED", message: "当前账号不能领取" } };
  }
  return null;
}

/** keys = a single key, or null/undefined for "everything claimable". */
export function claimAchievements(userId, key = null) {
  const db = openDb();
  const g = guard(db, userId);
  if (g) return g;
  let def = null;
  if (key != null) {
    def = BY_KEY.get(String(key));
    if (!def) return { error: { status: 404, code: "UNKNOWN_ACHIEVEMENT", message: "没有这个成就" } };
  }
  const result = db.transaction(() => {
    const values = metricValues(db, userId);
    const targets = def ? [def] : ACHIEVEMENTS;
    const paid = [];
    for (const a of targets) {
      if (values[a.metric] < a.target) continue;
      const r = claimOne(db, userId, a);
      if (r) paid.push({ key: a.key, name: a.name, ...r });
    }
    return paid;
  })();
  if (def && result.length === 0) {
    const already = db.prepare(`SELECT 1 FROM user_achievements WHERE user_id = ? AND key = ?`).get(userId, def.key);
    return {
      error: already
        ? { status: 409, code: "ALREADY_CLAIMED", message: "已经领取过了", details: getAchievementState(userId, { db }) }
        : { status: 409, code: "NOT_REACHED", message: "还没达成这个成就", details: getAchievementState(userId, { db }) },
    };
  }
  const coins = result.reduce((s, r) => s + r.coins, 0);
  return { status: 200, data: { claimed: result, coins, state: getAchievementState(userId, { db }) } };
}
