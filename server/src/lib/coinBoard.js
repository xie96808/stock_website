/**
 * 韭币榜 — two boards over real players only:
 *   balance  current 韭币 balance
 *   week     this week's net earnings (Mon 00:00 Asia/Shanghai): game/battle profit + daily income
 * Eligible = active, role 'user', not a bot, leaderboard_opt_in = 1 (same bar as the practice board).
 * The top three of the balance board wear a gold / silver / bronze plaque on their avatar (`medalProp`).
 *
 * Week net sums only these ledger reasons — registration / achievement / admin grants and shop purchases are
 * deliberately not part of it, so the board reflects play and daily habit, not gifts or spending.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { challengeNow } from "./dailyChallenge.js";
import { frameProp } from "./frameProp.js";

export const TOP_N = 20;
const CACHE_TTL_MS = Number(process.env.COIN_BOARD_CACHE_TTL_MS || 60_000);
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const WEEK_NET_REASONS = [
  "stake_escrow",
  "stake_payout",
  "pvp_entry",
  "pvp_reward",
  "pvp_refund",
  "daily_claim",
  "lucky_wheel", // coin prizes of the 幸运转盘 (luckyWheel.js WHEEL_REASON); "wheel_prize" is the item ledger, not coins
  "streak_claim",
  "quiz_daily_reward",
];
export const MEDALS = ["gold", "silver", "bronze"];

export function coinBoardEnabled() {
  return !!config.coinBoardEnabled;
}

/** SQLite `datetime('now')` text (UTC) of the most recent Monday 00:00 in Asia/Shanghai. */
export function weekStartUtc(nowMs = challengeNow().getTime()) {
  const sh = new Date(nowMs + SHANGHAI_OFFSET_MS); // fields read via getUTC* are Shanghai wall clock
  const sinceMonday = (sh.getUTCDay() + 6) % 7;
  const mondayShMs = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() - sinceMonday);
  return new Date(mondayShMs - SHANGHAI_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

const ELIGIBLE = `u.status = 'active' AND u.role = 'user' AND u.is_bot = 0 AND u.leaderboard_opt_in = 1`;
const cache = new Map(); // board -> { at, weekKey, rows }

export function invalidateCoinBoardCache() {
  cache.clear();
}

function loadRows(board) {
  const db = openDb();
  if (board === "balance") {
    return db
      .prepare(
        `SELECT u.id AS user_id, u.nickname, u.avatar_id, u.avatar_custom_path, u.avatar_frame,
                u.jiu_coin_balance AS value
         FROM users u WHERE ${ELIGIBLE}
         ORDER BY u.jiu_coin_balance DESC, u.id ASC LIMIT 5000`
      )
      .all();
  }
  const marks = WEEK_NET_REASONS.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT u.id AS user_id, u.nickname, u.avatar_id, u.avatar_custom_path, u.avatar_frame,
              SUM(l.delta) AS value
       FROM jiu_coin_ledger l JOIN users u ON u.id = l.user_id
       WHERE ${ELIGIBLE} AND l.created_at >= ? AND l.reason IN (${marks})
       GROUP BY u.id HAVING SUM(l.delta) > 0
       ORDER BY value DESC, u.id ASC LIMIT 5000`
    )
    .all(weekStartUtc(), ...WEEK_NET_REASONS);
}

function ranked(board) {
  const now = Date.now();
  const weekKey = board === "week" ? weekStartUtc() : "";
  const hit = cache.get(board);
  if (hit && now - hit.at < CACHE_TTL_MS && hit.weekKey === weekKey) return hit.rows;
  const rows = loadRows(board).map((r, i) => ({ ...r, rank: i + 1, value: Number(r.value) || 0 }));
  cache.set(board, { at: now, weekKey, rows });
  return rows;
}

/** Medal ("gold" | "silver" | "bronze") of a user, or null. Flag-gated. */
export function medalFor(userId) {
  if (!coinBoardEnabled() || userId == null) return null;
  const top = ranked("balance").slice(0, MEDALS.length);
  const i = top.findIndex((r) => r.user_id === userId);
  return i >= 0 ? MEDALS[i] : null;
}

/** Spread into any avatar DTO next to frameProp: emits `{avatarMedal}` only for the balance-board top three. */
export function medalProp(userId) {
  const m = medalFor(userId);
  return m ? { avatarMedal: m } : {};
}

function publicRow(r, board) {
  const custom = r.avatar_custom_path || null;
  return {
    rank: r.rank,
    nickname: r.nickname,
    avatarId: r.avatar_id,
    avatarUrl: custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null,
    ...frameProp(r.avatar_frame),
    ...(board === "balance" && r.rank <= MEDALS.length ? { avatarMedal: MEDALS[r.rank - 1] } : {}),
    value: r.value,
  };
}

/**
 * @param {"balance"|"week"} board
 * @param {object|null} viewer the logged-in user row/DTO (needs id, leaderboardOptIn|leaderboard_opt_in)
 */
export function getCoinBoard(board, viewer = null) {
  if (!coinBoardEnabled()) {
    return { error: { status: 403, code: "FEATURE_DISABLED", message: "韭币榜暂未开放" } };
  }
  if (board !== "balance" && board !== "week") {
    return { error: { status: 400, code: "INVALID_BOARD", message: "board 必须为 balance 或 week" } };
  }
  const rows = ranked(board);
  const data = {
    board,
    entries: rows.slice(0, TOP_N).map((r) => publicRow(r, board)),
    total: rows.length,
    ...(board === "week" ? { weekStart: weekStartUtc() } : {}),
  };
  if (viewer) {
    const optIn = viewer.leaderboardOptIn ?? !!viewer.leaderboard_opt_in;
    const mine = rows.find((r) => r.user_id === viewer.id);
    if (mine) data.me = { rank: mine.rank, value: mine.value };
    else if (!optIn) data.me = { rank: null, reason: "not_opted_in" };
    else {
      const bal = Number(viewer.jiuCoinBalance ?? viewer.jiu_coin_balance) || 0;
      data.me = { rank: null, reason: board === "week" ? "no_net_gain" : "not_ranked", ...(board === "balance" ? { value: bal } : {}) };
    }
  }
  return { status: 200, data };
}
