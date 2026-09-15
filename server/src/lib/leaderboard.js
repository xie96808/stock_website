import { openDb } from "../db/connection.js";
import { ensureDatasetLoaded } from "./dataset.js";
import { RULE_VERSION, FILL_MODES } from "../../../shared/rules.js";
import {
  ASSIST_QUERY_SET,
  ASSIST_CLEAN,
  ASSIST_ALL,
  GAME_KIND_CLASSIC,
  GAME_KIND_ONESHOT,
  GAME_KIND_SURVIVAL,
} from "../../../shared/protocol.js";
import { config } from "./config.js";

const FILL_SET = new Set(FILL_MODES);
const METRIC_SET = new Set(["best", "average"]);
/** Practice boards only — daily/puzzle stay on their own endpoints. */
const LEADERBOARD_KIND_SET = new Set([
  GAME_KIND_CLASSIC,
  GAME_KIND_ONESHOT,
  GAME_KIND_SURVIVAL,
]);
const TOP_N = 10;

/** Short in-memory TTL for shared board (topN + total). Viewer fields stay request-scoped. */
const CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS || 8000);

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const boardCache = new Map();

/**
 * Resolve board key; defaults to current published rule + dataset versions.
 * metric defaults to "best" (最佳单局).
 */
export function resolveBoardKey(query = {}) {
  const meta = ensureDatasetLoaded();
  const fillMode = query.fillMode;
  if (!FILL_SET.has(fillMode)) {
    return {
      error: {
        status: 400,
        code: "INVALID_FILL_MODE",
        message: "fillMode 必填且必须为 next_open 或 same_close",
      },
    };
  }
  let metric = "best";
  if (query.metric != null && query.metric !== "") {
    if (!METRIC_SET.has(query.metric)) {
      return {
        error: {
          status: 400,
          code: "INVALID_METRIC",
          message: "metric 必须为 best 或 average",
        },
      };
    }
    metric = query.metric;
  }
  const ruleVersion =
    typeof query.ruleVersion === "string" && query.ruleVersion.trim()
      ? query.ruleVersion.trim()
      : RULE_VERSION;
  const datasetVersion =
    typeof query.datasetVersion === "string" && query.datasetVersion.trim()
      ? query.datasetVersion.trim()
      : meta.version;

  // gameKind: classic (default) | oneshot | survival. Old clients omit → classic.
  let gameKind = GAME_KIND_CLASSIC;
  if (query.gameKind != null && query.gameKind !== "") {
    const rawKind = String(query.gameKind);
    if (!LEADERBOARD_KIND_SET.has(rawKind)) {
      return {
        error: {
          status: 400,
          code: "INVALID_GAME_KIND",
          message: "gameKind 必须为 classic、oneshot 或 survival",
        },
      };
    }
    gameKind = rawKind;
  }

  // F03: assist boards only for classic when GAME_REWIND_ENABLED.
  // oneshot/survival ignore assistClass (no rewind assist boards).
  // assistClass=all → 总榜 = classic clean ∪ undo (after legacy→clean migration).
  let assistClass = null;
  if (gameKind === GAME_KIND_CLASSIC && config.gameRewindEnabled) {
    const raw = query.assistClass;
    if (raw == null || raw === "") {
      assistClass = ASSIST_CLEAN;
    } else if (ASSIST_QUERY_SET.has(String(raw))) {
      assistClass = String(raw);
    } else {
      return {
        error: {
          status: 400,
          code: "INVALID_ASSIST_CLASS",
          message: "assistClass 必须为 clean、undo、legacy 或 all",
        },
      };
    }
  }

  return { fillMode, metric, ruleVersion, datasetVersion, assistClass, gameKind };
}

function boardCacheKey(board) {
  const assist = board.assistClass || "_all";
  const kind = board.gameKind || GAME_KIND_CLASSIC;
  return `${board.fillMode}\0${board.metric}\0${board.ruleVersion}\0${board.datasetVersion}\0${assist}\0${kind}`;
}

/**
 * Drop cached boards. Pass fillMode to clear one mode across metrics/versions, or omit to clear all.
 * Call after settle / unlist / ban / opt-in (and test helpers that mutate ranks).
 */
export function invalidateLeaderboardCache(fillMode) {
  if (!fillMode) {
    boardCache.clear();
    return;
  }
  for (const key of boardCache.keys()) {
    if (key.startsWith(`${fillMode}\0`)) boardCache.delete(key);
  }
}

/** Test / ops helper */
export function getLeaderboardCacheStats() {
  return { size: boardCache.size, ttlMs: CACHE_TTL_MS };
}

function ppmToPct(ppm) {
  return (ppm / 10000).toFixed(2);
}

function publicEntry(row, { includeBusted = false } = {}) {
  const custom = row.avatar_custom_path || null;
  const entry = {
    rank: row.rank,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    avatarUrl: custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null,
    returnPpm: row.return_ppm,
    returnPct: ppmToPct(row.return_ppm),
    finishedAt: row.finished_at,
    gameCount: row.game_count != null ? Number(row.game_count) : 0,
    winRate: row.win_rate != null ? Number(row.win_rate) : null,
  };
  if (includeBusted) {
    entry.busted = Number(row.is_busted || 0) === 1;
  }
  return entry;
}

/**
 * Eligible best-seat SQL fragment (binds: rule, dataset, fill ×1).
 * One row per opted-in active user with at least one eligible settled game.
 */
const BEST_SEATS_CTE = `
  WITH eligible AS (
    SELECT
      s.user_id AS user_id,
      s.id AS game_id,
      s.finished_at AS finished_at,
      r.return_ppm AS return_ppm,
      __BUST_EXPR__ AS is_busted,
      u.nickname AS nickname,
      u.avatar_id AS avatar_id,
      u.avatar_custom_path AS avatar_custom_path,
      ROW_NUMBER() OVER (
        PARTITION BY s.user_id
        ORDER BY __SEAT_ORDER__
      ) AS seat_rn
    FROM game_sessions s
    JOIN game_results r ON r.game_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'settled'
      AND s.rule_version = ?
      AND s.dataset_version = ?
      AND s.fill_mode = ?__ASSIST__
      AND r.validity = 'valid'
      AND r.leaderboard_hidden = 0
      AND r.trade_count >= 1
      AND u.status = 'active'
      AND u.role = 'user'
      AND u.leaderboard_opt_in = 1
  ),
  seats AS (
    SELECT user_id, game_id, finished_at, return_ppm, is_busted, nickname, avatar_id, avatar_custom_path
    FROM eligible
    WHERE seat_rn = 1
  )
`;

/**
 * Average-seat CTE: arithmetic mean of eligible return_ppm per user (same eligibility as best).
 * Ranking uses exact avg (return_avg); display uses ROUND → return_ppm.
 * Tie-break: MIN(finished_at) ASC, user_id ASC.
 */
const AVG_SEATS_CTE = `
  WITH eligible AS (
    SELECT
      s.user_id AS user_id,
      s.finished_at AS finished_at,
      r.return_ppm AS return_ppm
    FROM game_sessions s
    JOIN game_results r ON r.game_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'settled'
      AND s.rule_version = ?
      AND s.dataset_version = ?
      AND s.fill_mode = ?__ASSIST__
      AND r.validity = 'valid'
      AND r.leaderboard_hidden = 0
      AND r.trade_count >= 1
      AND u.status = 'active'
      AND u.role = 'user'
      AND u.leaderboard_opt_in = 1
  ),
  seats AS (
    SELECT
      e.user_id AS user_id,
      AVG(e.return_ppm * 1.0) AS return_avg,
      CAST(ROUND(AVG(e.return_ppm * 1.0)) AS INTEGER) AS return_ppm,
      MIN(e.finished_at) AS finished_at,
      0 AS is_busted,
      u.nickname AS nickname,
      u.avatar_id AS avatar_id,
      u.avatar_custom_path AS avatar_custom_path
    FROM eligible e
    JOIN users u ON u.id = e.user_id
    GROUP BY e.user_id, u.nickname, u.avatar_id, u.avatar_custom_path
  )
`;

/** Survival: busted from valuation_json (kind=bust or busted=true). Else 0. */
function bustExprSql(board) {
  if (board.gameKind === GAME_KIND_SURVIVAL) {
    return `CASE
      WHEN json_extract(r.valuation_json, '$.kind') = 'bust' THEN 1
      WHEN json_extract(r.valuation_json, '$.busted') = 1 THEN 1
      ELSE 0
    END`;
  }
  return "0";
}

function seatOrderSql(board) {
  // Survival best: 活穿 (not busted) first, then return — same tie-break as classic.
  // Use bustExprSql (not alias) — SQLite window ORDER BY cannot see SELECT aliases.
  if (board.gameKind === GAME_KIND_SURVIVAL) {
    return `(${bustExprSql(board)}) ASC, r.return_ppm DESC, s.finished_at ASC, s.id ASC`;
  }
  return "r.return_ppm DESC, s.finished_at ASC, s.id ASC";
}

function boardOrderSql(board) {
  if (board.metric === "average") {
    return "return_avg DESC, finished_at ASC, user_id ASC";
  }
  if (board.gameKind === GAME_KIND_SURVIVAL) {
    return "is_busted ASC, return_ppm DESC, finished_at ASC, user_id ASC";
  }
  return "return_ppm DESC, finished_at ASC, user_id ASC";
}

function seatsCte(metric, board) {
  const base = metric === "average" ? AVG_SEATS_CTE : BEST_SEATS_CTE;
  return base
    .replaceAll("__ASSIST__", kindAssistSql(board))
    .replaceAll("__BUST_EXPR__", bustExprSql(board))
    .replaceAll("__SEAT_ORDER__", seatOrderSql(board));
}

function kindAssistSql(board) {
  const kind = board.gameKind || GAME_KIND_CLASSIC;
  if (kind === GAME_KIND_ONESHOT || kind === GAME_KIND_SURVIVAL) {
    return " AND s.game_kind = ?";
  }
  // Classic practice board — oneshot/survival/daily/puzzle never mix in.
  if (!board.assistClass) return " AND s.game_kind = 'classic'";
  if (board.assistClass === ASSIST_ALL) {
    // 总榜: clean ∪ undo (post-migration; no legacy population advertised).
    return " AND s.game_kind = 'classic' AND s.assist_class IN ('clean', 'undo')";
  }
  return " AND s.assist_class = ? AND s.game_kind = 'classic'";
}

function boardBinds(board) {
  const binds = [board.ruleVersion, board.datasetVersion, board.fillMode];
  const kind = board.gameKind || GAME_KIND_CLASSIC;
  if (kind === GAME_KIND_ONESHOT || kind === GAME_KIND_SURVIVAL) {
    binds.push(kind);
  } else if (board.assistClass && board.assistClass !== ASSIST_ALL) {
    binds.push(board.assistClass);
  }
  return binds;
}

function loadUserStatsMap(db, userIds, board) {
  const map = new Map();
  if (!userIds.length) return map;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
         s.user_id AS user_id,
         COUNT(*) AS game_count,
         SUM(CASE WHEN r.return_ppm > 0 THEN 1 ELSE 0 END) AS win_count
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       WHERE s.user_id IN (${placeholders})
         AND s.status = 'settled'
         AND s.rule_version = ?
         AND s.dataset_version = ?
         AND s.fill_mode = ?${kindAssistSql(board)}
         AND r.validity = 'valid'
       GROUP BY s.user_id`
    )
    .all(...userIds, ...boardBinds(board));
  for (const row of rows) {
    const gameCount = Number(row.game_count || 0);
    const winCount = Number(row.win_count || 0);
    map.set(row.user_id, {
      game_count: gameCount,
      win_rate: gameCount
        ? Number(((100.0 * winCount) / gameCount).toFixed(2))
        : null,
    });
  }
  return map;
}

/**
 * Shared board payload: Top N + total only (not full rank list).
 * Stats are attached only for the Top N user ids.
 */
function computeSharedBoard(db, board) {
  const binds = boardBinds(board);
  const cte = seatsCte(board.metric, board);
  const orderExpr = boardOrderSql(board);
  const includeBusted = board.gameKind === GAME_KIND_SURVIVAL;

  const topRows = db
    .prepare(
      `${cte}
       SELECT
         user_id,
         finished_at,
         return_ppm,
         is_busted,
         nickname,
         avatar_id,
         avatar_custom_path,
         ROW_NUMBER() OVER (
           ORDER BY ${orderExpr}
         ) AS rank
       FROM seats
       ORDER BY ${orderExpr}
       LIMIT ?`
    )
    .all(...binds, TOP_N);

  const totalRow = db
    .prepare(`${cte} SELECT COUNT(*) AS n FROM seats`)
    .get(...binds);
  const total = Number(totalRow?.n || 0);

  const stats = loadUserStatsMap(
    db,
    topRows.map((r) => r.user_id),
    board
  );
  for (const row of topRows) {
    const st = stats.get(row.user_id);
    row.game_count = st?.game_count ?? 0;
    row.win_rate = st?.win_rate ?? null;
  }

  return {
    fillMode: board.fillMode,
    metric: board.metric,
    ruleVersion: board.ruleVersion,
    datasetVersion: board.datasetVersion,
    assistClass: board.assistClass,
    gameKind: board.gameKind || GAME_KIND_CLASSIC,
    asOf: new Date().toISOString(),
    top10: topRows.map((r) => publicEntry(r, { includeBusted })),
    total,
    /** Compact seats for myRank when viewer is inside Top N (avoid extra query). */
    _topUserIds: topRows.map((r) => ({ userId: r.user_id, rank: r.rank })),
  };
}

function getSharedBoard(db, board) {
  const key = boardCacheKey(board);
  const now = Date.now();
  if (CACHE_TTL_MS > 0) {
    const hit = boardCache.get(key);
    if (hit && hit.expiresAt > now) {
      return { ...hit.payload, _cacheHit: true };
    }
  }
  const payload = computeSharedBoard(db, board);
  if (CACHE_TTL_MS > 0) {
    boardCache.set(key, { expiresAt: now + CACHE_TTL_MS, payload });
  }
  return { ...payload, _cacheHit: false };
}

function userIneligibility(db, user, board) {
  if (!user) return null;
  if (user.status && user.status !== "active") {
    return "account_not_active";
  }
  if (user.role === "admin") {
    return "admin_role";
  }
  const optIn = user.leaderboardOptIn != null
    ? !!user.leaderboardOptIn
    : !!user.leaderboard_opt_in;
  if (!optIn) {
    return "not_opted_in";
  }

  const row = db
    .prepare(
      `SELECT r.game_id
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       WHERE s.user_id = ?
         AND s.status = 'settled'
         AND s.rule_version = ?
         AND s.dataset_version = ?
         AND s.fill_mode = ?${kindAssistSql(board)}
         AND r.validity = 'valid'
         AND r.leaderboard_hidden = 0
         AND r.trade_count >= 1
       LIMIT 1`
    )
    .get(user.id, ...boardBinds(board));
  if (!row) {
    return "no_eligible_game";
  }
  return null;
}

function loadUserBoardStats(db, userId, board) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS game_count,
         SUM(CASE WHEN r.return_ppm > 0 THEN 1 ELSE 0 END) AS win_count
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       WHERE s.user_id = ?
         AND s.status = 'settled'
         AND s.rule_version = ?
         AND s.dataset_version = ?
         AND s.fill_mode = ?${kindAssistSql(board)}
         AND r.validity = 'valid'`
    )
    .get(userId, ...boardBinds(board));
  const gameCount = Number(row?.game_count || 0);
  if (!gameCount) return { gameCount: 0, winRate: null };
  const winCount = Number(row.win_count || 0);
  return {
    gameCount,
    winRate: Number(((winCount / gameCount) * 100).toFixed(2)),
  };
}

/**
 * Viewer's best eligible seat on this board (for rank lookup outside Top N).
 */
function loadViewerBestSeat(db, userId, board) {
  const bust = bustExprSql(board);
  const orderBy =
    board.gameKind === GAME_KIND_SURVIVAL
      ? "is_busted ASC, return_ppm DESC, finished_at ASC, game_id ASC"
      : "return_ppm DESC, finished_at ASC, game_id ASC";
  return db
    .prepare(
      `SELECT user_id, game_id, finished_at, return_ppm, is_busted FROM (
         SELECT s.user_id AS user_id,
                s.id AS game_id,
                s.finished_at AS finished_at,
                r.return_ppm AS return_ppm,
                ${bust} AS is_busted
         FROM game_sessions s
         JOIN game_results r ON r.game_id = s.id
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = ?
           AND s.status = 'settled'
           AND s.rule_version = ?
           AND s.dataset_version = ?
           AND s.fill_mode = ?${kindAssistSql(board)}
           AND r.validity = 'valid'
           AND r.leaderboard_hidden = 0
           AND r.trade_count >= 1
           AND u.status = 'active'
           AND u.role = 'user'
           AND u.leaderboard_opt_in = 1
       )
       ORDER BY ${orderBy}
       LIMIT 1`
    )
    .get(userId, ...boardBinds(board));
}

/**
 * Viewer's average eligible seat (exact avg + rounded display ppm + min finished_at).
 */
function loadViewerAverageSeat(db, userId, board) {
  return db
    .prepare(
      `SELECT
         s.user_id AS user_id,
         AVG(r.return_ppm * 1.0) AS return_avg,
         CAST(ROUND(AVG(r.return_ppm * 1.0)) AS INTEGER) AS return_ppm,
         MIN(s.finished_at) AS finished_at,
         0 AS is_busted
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ?
         AND s.status = 'settled'
         AND s.rule_version = ?
         AND s.dataset_version = ?
         AND s.fill_mode = ?${kindAssistSql(board)}
         AND r.validity = 'valid'
         AND r.leaderboard_hidden = 0
         AND r.trade_count >= 1
         AND u.status = 'active'
         AND u.role = 'user'
         AND u.leaderboard_opt_in = 1
       GROUP BY s.user_id`
    )
    .get(userId, ...boardBinds(board));
}

function loadViewerSeat(db, userId, board) {
  return board.metric === "average"
    ? loadViewerAverageSeat(db, userId, board)
    : loadViewerBestSeat(db, userId, board);
}

/**
 * Deterministic dense rank: 1 + count of seats strictly better.
 * best: return_ppm DESC, finished_at ASC, user_id ASC
 * average: return_avg DESC, finished_at ASC, user_id ASC
 */
function rankForSeat(db, board, seat) {
  const binds = boardBinds(board);
  const cte = seatsCte(board.metric, board);
  if (board.metric === "average") {
    const row = db
      .prepare(
        `${cte}
         SELECT COUNT(*) AS better
         FROM seats
         WHERE return_avg > ?
            OR (return_avg = ? AND finished_at < ?)
            OR (return_avg = ? AND finished_at = ? AND user_id < ?)`
      )
      .get(
        ...binds,
        seat.return_avg,
        seat.return_avg,
        seat.finished_at,
        seat.return_avg,
        seat.finished_at,
        seat.user_id
      );
    return Number(row?.better || 0) + 1;
  }
  if (board.gameKind === GAME_KIND_SURVIVAL) {
    const busted = Number(seat.is_busted || 0);
    const row = db
      .prepare(
        `${cte}
         SELECT COUNT(*) AS better
         FROM seats
         WHERE is_busted < ?
            OR (is_busted = ? AND return_ppm > ?)
            OR (is_busted = ? AND return_ppm = ? AND finished_at < ?)
            OR (is_busted = ? AND return_ppm = ? AND finished_at = ? AND user_id < ?)`
      )
      .get(
        ...binds,
        busted,
        busted,
        seat.return_ppm,
        busted,
        seat.return_ppm,
        seat.finished_at,
        busted,
        seat.return_ppm,
        seat.finished_at,
        seat.user_id
      );
    return Number(row?.better || 0) + 1;
  }
  const row = db
    .prepare(
      `${cte}
       SELECT COUNT(*) AS better
       FROM seats
       WHERE return_ppm > ?
          OR (return_ppm = ? AND finished_at < ?)
          OR (return_ppm = ? AND finished_at = ? AND user_id < ?)`
    )
    .get(
      ...binds,
      seat.return_ppm,
      seat.return_ppm,
      seat.finished_at,
      seat.return_ppm,
      seat.finished_at,
      seat.user_id
    );
  return Number(row?.better || 0) + 1;
}

/**
 * GET /leaderboard payload.
 * @param {{ fillMode, metric?, ruleVersion?, datasetVersion? }} query
 * @param {object|null} viewerUser publicUser-shaped or null
 */
export function getLeaderboard(query = {}, viewerUser = null) {
  const board = resolveBoardKey(query);
  if (board.error) return { error: board.error };

  const db = openDb();
  const shared = getSharedBoard(db, board);

  let myRank = null;
  let myGameCount = null;
  let myWinRate = null;
  let ineligibilityReason = null;

  if (viewerUser) {
    const inTop = shared._topUserIds.find((s) => s.userId === viewerUser.id);
    if (inTop) {
      myRank = inTop.rank;
      const seat = shared.top10.find((r) => r.rank === inTop.rank);
      myGameCount = seat?.gameCount ?? 0;
      myWinRate = seat?.winRate ?? null;
      ineligibilityReason = null;
    } else {
      const seat = loadViewerSeat(db, viewerUser.id, board);
      if (seat) {
        myRank = rankForSeat(db, board, seat);
        const stats = loadUserBoardStats(db, viewerUser.id, board);
        myGameCount = stats.gameCount;
        myWinRate = stats.winRate;
        ineligibilityReason = null;
      } else {
        myRank = null;
        ineligibilityReason = userIneligibility(db, viewerUser, board);
        const stats = loadUserBoardStats(db, viewerUser.id, board);
        myGameCount = stats.gameCount;
        myWinRate = stats.winRate;
      }
    }
  }

  return {
    status: 200,
    data: {
      fillMode: shared.fillMode,
      metric: shared.metric,
      ruleVersion: shared.ruleVersion,
      datasetVersion: shared.datasetVersion,
      assistClass: shared.assistClass,
      gameKind: shared.gameKind || board.gameKind || GAME_KIND_CLASSIC,
      asOf: shared.asOf,
      top10: shared.top10,
      total: shared.total,
      myRank,
      myGameCount,
      myWinRate,
      ineligibilityReason,
    },
  };
}

/** Test helper: override return_ppm / finished_at after settle */
export function forceResultRanking(gameId, { returnPpm, finishedAt, tradeCount, validity, leaderboardHidden, ruleVersion } = {}) {
  const db = openDb();
  let fillMode = null;
  if (returnPpm != null || tradeCount != null || validity != null || leaderboardHidden != null) {
    const row = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
    if (!row) throw new Error(`no result for ${gameId}`);
    db.prepare(
      `UPDATE game_results SET
        return_ppm = ?,
        trade_count = ?,
        validity = ?,
        leaderboard_hidden = ?
       WHERE game_id = ?`
    ).run(
      returnPpm != null ? returnPpm : row.return_ppm,
      tradeCount != null ? tradeCount : row.trade_count,
      validity != null ? validity : row.validity,
      leaderboardHidden != null ? (leaderboardHidden ? 1 : 0) : row.leaderboard_hidden,
      gameId
    );
  }
  if (finishedAt != null || ruleVersion != null) {
    const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
    if (!sess) throw new Error(`no session for ${gameId}`);
    fillMode = sess.fill_mode;
    db.prepare(
      `UPDATE game_sessions SET finished_at = ?, rule_version = ? WHERE id = ?`
    ).run(
      finishedAt != null ? finishedAt : sess.finished_at,
      ruleVersion != null ? ruleVersion : sess.rule_version,
      gameId
    );
  } else {
    const sess = db.prepare(`SELECT fill_mode FROM game_sessions WHERE id = ?`).get(gameId);
    fillMode = sess?.fill_mode || null;
  }
  invalidateLeaderboardCache(fillMode || undefined);
}

export function setUserFlags(userId, { role, status, leaderboardOptIn } = {}) {
  const db = openDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!row) throw new Error(`no user ${userId}`);
  db.prepare(
    `UPDATE users SET
      role = ?,
      status = ?,
      leaderboard_opt_in = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    role != null ? role : row.role,
    status != null ? status : row.status,
    leaderboardOptIn != null ? (leaderboardOptIn ? 1 : 0) : row.leaderboard_opt_in,
    userId
  );
  invalidateLeaderboardCache();
}
