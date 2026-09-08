import { openDb } from "../db/connection.js";
import { ensureDatasetLoaded } from "./dataset.js";
import { RULE_VERSION, FILL_MODES } from "../../../shared/rules.js";

const FILL_SET = new Set(FILL_MODES);
const TOP_N = 10;

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
 * Eligible settled games for a board, one best seat per user.
 * Ranking: return_ppm DESC, finished_at ASC, user_id ASC — deterministic ranks.
 * Per-user gameCount/winRate match me/stats: settled + validity=valid on board key
 * (does not require trade_count >= 1).
 */
function loadRankedSeats(db, { ruleVersion, datasetVersion, fillMode }) {
  const sql = `
    WITH user_stats AS (
      SELECT
        s.user_id AS user_id,
        COUNT(*) AS game_count,
        SUM(CASE WHEN r.return_ppm > 0 THEN 1 ELSE 0 END) AS win_count
      FROM game_sessions s
      JOIN game_results r ON r.game_id = s.id
      WHERE s.status = 'settled'
        AND s.rule_version = ?
        AND s.dataset_version = ?
        AND s.fill_mode = ?
        AND r.validity = 'valid'
      GROUP BY s.user_id
    ),
    eligible AS (
      SELECT
        s.user_id AS user_id,
        s.id AS game_id,
        s.finished_at AS finished_at,
        r.return_ppm AS return_ppm,
        u.nickname AS nickname,
        u.avatar_id AS avatar_id,
        u.avatar_custom_path AS avatar_custom_path,
        COALESCE(st.game_count, 0) AS game_count,
        CASE
          WHEN COALESCE(st.game_count, 0) = 0 THEN NULL
          ELSE ROUND(100.0 * st.win_count / st.game_count, 2)
        END AS win_rate,
        ROW_NUMBER() OVER (
          PARTITION BY s.user_id
          ORDER BY r.return_ppm DESC, s.finished_at ASC, s.id ASC
        ) AS seat_rn
      FROM game_sessions s
      JOIN game_results r ON r.game_id = s.id
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_stats st ON st.user_id = s.user_id
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
      SELECT * FROM eligible WHERE seat_rn = 1
    ),
    ranked AS (
      SELECT
        user_id,
        game_id,
        finished_at,
        return_ppm,
        nickname,
        avatar_id,
        avatar_custom_path,
        game_count,
        win_rate,
        ROW_NUMBER() OVER (
          ORDER BY return_ppm DESC, finished_at ASC, user_id ASC
        ) AS rank
      FROM best
    )
    SELECT * FROM ranked ORDER BY rank ASC
  `;
  return db.prepare(sql).all(
    ruleVersion, datasetVersion, fillMode,
    ruleVersion, datasetVersion, fillMode
  );
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
 * GET /leaderboard payload.
 * @param {{ fillMode, ruleVersion?, datasetVersion? }} query
 * @param {object|null} viewerUser publicUser-shaped or null
 */
export function getLeaderboard(query = {}, viewerUser = null) {
  const board = resolveBoardKey(query);
  if (board.error) return { error: board.error };

  const db = openDb();
  const asOf = new Date().toISOString();
  const ranked = loadRankedSeats(db, board);
  const top10 = ranked.slice(0, TOP_N).map(publicEntry);

  let myRank = null;
  let myGameCount = null;
  let myWinRate = null;
  let ineligibilityReason = null;

  if (viewerUser) {
    const seat = ranked.find((r) => r.user_id === viewerUser.id);
    if (seat) {
      myRank = seat.rank;
      myGameCount = Number(seat.game_count || 0);
      myWinRate = seat.win_rate != null ? Number(seat.win_rate) : null;
      ineligibilityReason = null;
    } else {
      myRank = null;
      ineligibilityReason = userIneligibility(db, viewerUser, board);
      const stats = loadUserBoardStats(db, viewerUser.id, board);
      myGameCount = stats.gameCount;
      myWinRate = stats.winRate;
    }
  }

  return {
    status: 200,
    data: {
      fillMode: board.fillMode,
      ruleVersion: board.ruleVersion,
      datasetVersion: board.datasetVersion,
      asOf,
      top10,
      total: ranked.length,
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
    db.prepare(
      `UPDATE game_sessions SET finished_at = ?, rule_version = ? WHERE id = ?`
    ).run(
      finishedAt != null ? finishedAt : sess.finished_at,
      ruleVersion != null ? ruleVersion : sess.rule_version,
      gameId
    );
  }
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
}
