import { openDb } from "../db/connection.js";
import { ensureDatasetLoaded } from "./dataset.js";
import { RULE_VERSION, FILL_MODES } from "../../../shared/rules.js";

const FILL_SET = new Set(FILL_MODES);
const TOP_N = 10;

/** Short in-memory TTL for shared board (topN + total). Viewer fields stay request-scoped. */
const CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS || 8000);

/** @type {Map<string, { expiresAt: number, payload: object }>} */
const boardCache = new Map();

/**
 * Resolve board key; defaults to current published rule + dataset versions.
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
  const ruleVersion =
    typeof query.ruleVersion === "string" && query.ruleVersion.trim()
      ? query.ruleVersion.trim()
      : RULE_VERSION;
  const datasetVersion =
    typeof query.datasetVersion === "string" && query.datasetVersion.trim()
      ? query.datasetVersion.trim()
      : meta.version;
  return { fillMode, ruleVersion, datasetVersion };
}

function boardCacheKey(board) {
  return `${board.fillMode}\0${board.ruleVersion}\0${board.datasetVersion}`;
}

/**
 * Drop cached boards. Pass fillMode to clear one mode across versions, or omit to clear all.
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

function publicEntry(row) {
  const custom = row.avatar_custom_path || null;
  return {
    rank: row.rank,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    avatarUrl: custom ? `/api/v1/avatars/${custom}` : null,
    returnPpm: row.return_ppm,
    returnPct: ppmToPct(row.return_ppm),
    finishedAt: row.finished_at,
    gameCount: row.game_count != null ? Number(row.game_count) : 0,
    winRate: row.win_rate != null ? Number(row.win_rate) : null,
  };
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
      u.nickname AS nickname,
      u.avatar_id AS avatar_id,
      u.avatar_custom_path AS avatar_custom_path,
      ROW_NUMBER() OVER (
        PARTITION BY s.user_id
        ORDER BY r.return_ppm DESC, s.finished_at ASC, s.id ASC
      ) AS seat_rn
    FROM game_sessions s
    JOIN game_results r ON r.game_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE s.status = 'settled'
      AND s.rule_version = ?
      AND s.dataset_version = ?
      AND s.fill_mode = ?
      AND r.validity = 'valid'
      AND r.leaderboard_hidden = 0
      AND r.trade_count >= 1
      AND u.status = 'active'
      AND u.role = 'user'
      AND u.leaderboard_opt_in = 1
  ),
  best AS (
    SELECT user_id, game_id, finished_at, return_ppm, nickname, avatar_id, avatar_custom_path
    FROM eligible
    WHERE seat_rn = 1
  )
`;

function boardBinds(board) {
  return [board.ruleVersion, board.datasetVersion, board.fillMode];
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
         AND s.fill_mode = ?
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
  const topRows = db
    .prepare(
      `${BEST_SEATS_CTE}
       SELECT
         user_id,
         game_id,
         finished_at,
         return_ppm,
         nickname,
         avatar_id,
         avatar_custom_path,
         ROW_NUMBER() OVER (
           ORDER BY return_ppm DESC, finished_at ASC, user_id ASC
         ) AS rank
       FROM best
       ORDER BY return_ppm DESC, finished_at ASC, user_id ASC
       LIMIT ?`
    )
    .all(...binds, TOP_N);

  const totalRow = db
    .prepare(`${BEST_SEATS_CTE} SELECT COUNT(*) AS n FROM best`)
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
    ruleVersion: board.ruleVersion,
    datasetVersion: board.datasetVersion,
    asOf: new Date().toISOString(),
    top10: topRows.map(publicEntry),
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
         AND s.fill_mode = ?
         AND r.validity = 'valid'
         AND r.leaderboard_hidden = 0
         AND r.trade_count >= 1
       LIMIT 1`
    )
    .get(user.id, board.ruleVersion, board.datasetVersion, board.fillMode);
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
         AND s.fill_mode = ?
         AND r.validity = 'valid'`
    )
    .get(userId, board.ruleVersion, board.datasetVersion, board.fillMode);
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
  return db
    .prepare(
      `SELECT s.user_id AS user_id, s.id AS game_id, s.finished_at AS finished_at, r.return_ppm AS return_ppm
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ?
         AND s.status = 'settled'
         AND s.rule_version = ?
         AND s.dataset_version = ?
         AND s.fill_mode = ?
         AND r.validity = 'valid'
         AND r.leaderboard_hidden = 0
         AND r.trade_count >= 1
         AND u.status = 'active'
         AND u.role = 'user'
         AND u.leaderboard_opt_in = 1
       ORDER BY r.return_ppm DESC, s.finished_at ASC, s.id ASC
       LIMIT 1`
    )
    .get(userId, board.ruleVersion, board.datasetVersion, board.fillMode);
}

/**
 * Deterministic dense rank: 1 + count of seats strictly better
 * (return_ppm DESC, finished_at ASC, user_id ASC).
 */
function rankForSeat(db, board, seat) {
  const binds = boardBinds(board);
  const row = db
    .prepare(
      `${BEST_SEATS_CTE}
       SELECT COUNT(*) AS better
       FROM best
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
 * @param {{ fillMode, ruleVersion?, datasetVersion? }} query
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
      const seat = loadViewerBestSeat(db, viewerUser.id, board);
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
      ruleVersion: shared.ruleVersion,
      datasetVersion: shared.datasetVersion,
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
