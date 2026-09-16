/**
 * Phase C 幽灵对局 — yesterday ghost pool resolution (replayable settled runs).
 */
import { openDb } from "../db/connection.js";
import {
  challengeNow,
  shanghaiYmdAt,
  getChallengeByDate,
} from "./dailyChallenge.js";
import { GHOST_LABEL } from "../../../shared/ghost.js";
import { DECISION_DAYS } from "../../../shared/engine.js";

/** Max ghosts returned in preview / accepted in pool. */
export const GHOST_POOL_LIMIT = 50;

/**
 * Prefer board_eligible=1 with valid replay. If that set has fewer than this many
 * ghosts, also include other settled/settle_late daily attempts on the same
 * challenge that have a parseable full trajectory (documented product choice).
 */
export const GHOST_POOL_MIN_PREFERRED = 1;

const ACTION_SET = new Set(["buy", "sell", "hold"]);

function ymdPlusOffset(baseYmd, offsetDays) {
  const ms = Date.parse(`${baseYmd}T12:00:00+08:00`) + offsetDays * 24 * 60 * 60 * 1000;
  return shanghaiYmdAt(new Date(ms));
}

export function yesterdayShanghaiYmd(now = challengeNow()) {
  return ymdPlusOffset(shanghaiYmdAt(now), -1);
}

function avatarUrlFromRow(row) {
  const custom = row.avatar_custom_path || null;
  return custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null;
}

function parseStoredActions(raw) {
  let arr;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length < 1) return null;
  const out = [];
  for (const item of arr) {
    if (typeof item === "string" && ACTION_SET.has(item)) {
      out.push(item);
    } else if (item && typeof item === "object" && typeof item.action === "string" && ACTION_SET.has(item.action)) {
      out.push(item.action);
    } else {
      return null;
    }
  }
  return out;
}

function parseEquityCurve(raw) {
  if (raw == null || raw === "") return null;
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

const CANDIDATE_SELECT = `SELECT
         a.user_id AS user_id,
         a.game_id AS game_id,
         a.return_ppm AS return_ppm,
         a.mdd_ppm AS mdd_ppm,
         a.settled_at AS settled_at,
         a.board_eligible AS board_eligible,
         a.status AS attempt_status,
         u.nickname AS nickname,
         u.avatar_id AS avatar_id,
         u.avatar_custom_path AS avatar_custom_path,
         r.actions_json AS actions_json,
         r.equity_curve_json AS equity_curve_json
       FROM daily_challenge_attempts a
       JOIN users u ON u.id = a.user_id
       JOIN game_results r ON r.game_id = a.game_id
       WHERE a.challenge_id = ?
         AND u.status = 'active'`;

function fetchPreferredCandidates(db, challengeId) {
  return db
    .prepare(
      `${CANDIDATE_SELECT}
         AND a.board_eligible = 1
         AND a.status = 'settled'
       ORDER BY a.return_ppm DESC, a.mdd_ppm ASC, a.settled_at ASC, a.user_id ASC
       LIMIT ?`
    )
    .all(challengeId, GHOST_POOL_LIMIT * 3);
}

function fetchExpandedCandidates(db, challengeId) {
  // Same challenge only; settled + late (board_eligible=0). No classic/oneshot/other days.
  return db
    .prepare(
      `${CANDIDATE_SELECT}
         AND a.status IN ('settled', 'settle_late')
       ORDER BY a.board_eligible DESC, a.return_ppm DESC, a.mdd_ppm ASC, a.settled_at ASC, a.user_id ASC
       LIMIT ?`
    )
    .all(challengeId, GHOST_POOL_LIMIT * 3);
}

function rowToGhost(row, ymd) {
  const actions = parseStoredActions(row.actions_json);
  if (!actions || actions.length !== DECISION_DAYS) return null;
  return {
    userId: row.user_id,
    gameId: row.game_id,
    nickname: row.nickname || "幽灵选手",
    avatarId: row.avatar_id,
    avatarUrl: avatarUrlFromRow(row),
    returnPpm: row.return_ppm,
    mddPpm: row.mdd_ppm,
    actions,
    equityCurve: parseEquityCurve(row.equity_curve_json),
    label: GHOST_LABEL,
    sourceDate: ymd,
    boardEligible: !!row.board_eligible,
  };
}

function ghostsFromRows(rows, ymd) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.game_id)) continue;
    const ghost = rowToGhost(row, ymd);
    if (!ghost) continue;
    seen.add(row.game_id);
    out.push(ghost);
    if (out.length >= GHOST_POOL_LIMIT) break;
  }
  return out;
}

/**
 * Resolve yesterday's ghost pool: replayable settled daily runs on that challenge.
 * @returns {{
 *   ok: true, challenge, ghosts: object[], ghost: object, date, poolSource: string
 * } | { ok: false, code, date, challengeId?, message }}
 */
export function resolveYesterdayGhostPool(db = openDb(), now = challengeNow()) {
  const ymd = yesterdayShanghaiYmd(now);
  const challenge = getChallengeByDate(ymd, db);
  if (!challenge) {
    return { ok: false, code: "CHALLENGE_MISSING", date: ymd, message: "昨日挑战题目不存在" };
  }

  const preferredRows = fetchPreferredCandidates(db, challenge.id);
  let ghosts = ghostsFromRows(preferredRows, ymd);
  let poolSource = "board_eligible";

  if (ghosts.length < GHOST_POOL_MIN_PREFERRED) {
    const hadCandidates = preferredRows.length > 0;
    const expanded = ghostsFromRows(fetchExpandedCandidates(db, challenge.id), ymd);
    if (expanded.length) {
      ghosts = expanded;
      poolSource = "board_eligible_plus_settled";
    } else if (hadCandidates) {
      return {
        ok: false,
        code: "NO_REPLAY",
        date: ymd,
        challengeId: challenge.id,
        message: "幽灵回放数据缺失，暂无法开局",
      };
    }
  }

  if (!ghosts.length) {
    const anySettled = db
      .prepare(
        `SELECT 1 AS ok FROM daily_challenge_attempts a
         WHERE a.challenge_id = ? AND a.status IN ('settled', 'settle_late') LIMIT 1`
      )
      .get(challenge.id);
    if (anySettled) {
      return {
        ok: false,
        code: "NO_REPLAY",
        date: ymd,
        challengeId: challenge.id,
        message: "幽灵回放数据缺失，暂无法开局",
      };
    }
    return {
      ok: false,
      code: "NO_GHOST",
      date: ymd,
      challengeId: challenge.id,
      message: "昨日暂无幽灵可挑战",
    };
  }

  return {
    ok: true,
    challenge,
    ghosts,
    ghost: ghosts[0],
    date: ymd,
    poolSource,
  };
}

/**
 * Compat wrapper: yesterday's featured ghost (#1 / pool[0]).
 * @returns {{ ok: true, challenge, ghost } | { ok: false, code, date, challengeId? }}
 */
export function resolveYesterdayGhost(db = openDb(), now = challengeNow()) {
  const pool = resolveYesterdayGhostPool(db, now);
  if (!pool.ok) return pool;
  return {
    ok: true,
    challenge: pool.challenge,
    ghost: pool.ghost,
    ghosts: pool.ghosts,
    date: pool.date,
    poolSource: pool.poolSource,
  };
}

export function publicGhostIdentity(ghost) {
  if (!ghost) return null;
  return {
    gameId: ghost.gameId,
    nickname: ghost.nickname,
    avatarId: ghost.avatarId,
    avatarUrl: ghost.avatarUrl,
    label: ghost.label || GHOST_LABEL,
    returnPpm: ghost.returnPpm,
    returnPct:
      ghost.returnPpm == null ? null : (Number(ghost.returnPpm) / 10000).toFixed(2),
    userId: ghost.userId,
    sourceDate: ghost.sourceDate,
    boardEligible: ghost.boardEligible == null ? undefined : !!ghost.boardEligible,
  };
}

/**
 * Pick ghost from pool by gameId; omit / null → featured #1.
 * @returns {{ ok: true, ghost } | { ok: false, code, message }}
 */
export function pickGhostFromPool(pool, ghostGameId) {
  if (!pool?.ok || !pool.ghosts?.length) {
    return { ok: false, code: "NO_GHOST", message: "昨日暂无幽灵可挑战" };
  }
  if (ghostGameId == null || ghostGameId === "") {
    return { ok: true, ghost: pool.ghost };
  }
  const id = String(ghostGameId);
  const found = pool.ghosts.find((g) => g.gameId === id);
  if (!found) {
    return {
      ok: false,
      code: "GHOST_NOT_IN_POOL",
      message: "所选幽灵不在昨日可回放池中",
    };
  }
  return { ok: true, ghost: found };
}
