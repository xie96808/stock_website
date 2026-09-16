/**
 * Phase C 幽灵对局 — yesterday's daily challenge trajectories as solo ghost opponents.
 * Pool: all replayable settled runs on yesterday's challenge (prefer board_eligible).
 * Flag default OFF (GHOST_DUEL_ENABLED). No rooms / WS / daily-chance consumption.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { sha256Text } from "./dataset.js";
import { windowFromSessionRow } from "./gameWindowDto.js";
import {
  deductGameCreateCost,
  getJiuCoinBalance,
  JIU_COIN_GAME_CREATE_COST,
} from "./jiuCoin.js";
import {
  challengeNow,
  seedNearDailyChallenges,
  DAILY_FILL_MODE,
} from "./dailyChallenge.js";
import {
  GAME_KIND_GHOST,
  PROTOCOL_LEGACY_BATCH,
  ASSIST_LEGACY,
} from "../../../shared/protocol.js";
import { ghostModifiersJson, GHOST_LABEL } from "../../../shared/ghost.js";
import {
  resolveYesterdayGhostPool,
  resolveYesterdayGhost,
  pickGhostFromPool,
  publicGhostIdentity,
  yesterdayShanghaiYmd,
  GHOST_POOL_LIMIT,
  GHOST_POOL_MIN_PREFERRED,
} from "./ghostDuelPool.js";

export {
  resolveYesterdayGhostPool,
  resolveYesterdayGhost,
  pickGhostFromPool,
  publicGhostIdentity,
  yesterdayShanghaiYmd,
  GHOST_POOL_LIMIT,
  GHOST_POOL_MIN_PREFERRED,
};

/** Same as classic practice create cost; does not consume daily chance. */
export const GHOST_DUEL_COST = JIU_COIN_GAME_CREATE_COST;

export function requireGhostDuelEnabled() {
  if (!config.ghostDuelEnabled) {
    const err = new Error("幽灵对局暂未开放");
    err.code = "FEATURE_DISABLED";
    err.status = 403;
    throw err;
  }
}

function sessionPublicFromRow(row) {
  if (!row) return null;
  let modifiers = null;
  if (row.modifiers) {
    try {
      modifiers = typeof row.modifiers === "string" ? JSON.parse(row.modifiers) : row.modifiers;
    } catch {
      modifiers = null;
    }
  }
  const base = {
    gameId: row.id,
    ruleVersion: row.rule_version,
    datasetVersion: row.dataset_version,
    fillMode: row.fill_mode,
    stockIndex: row.stock_index,
    windowStartIndex: row.window_start,
    historyLength: row.history_length,
    gameDays: row.game_days,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    status: row.status,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at || null,
    gameKind: row.game_kind || "classic",
    modifiers,
    challengeId: row.challenge_id || null,
    protocolVersion: row.protocol_version || "legacy-batch",
    undoCount: row.undo_count ?? 0,
    assistClass: row.assist_class || "legacy",
    revision: row.revision ?? 0,
  };
  const win = windowFromSessionRow(row);
  if (win) base.window = win;
  return base;
}

/**
 * Preview for day-board entry (no actions leak).
 * `ghost` = featured #1 for compat; `ghosts` = full picker list.
 */
export function getGhostDuelPreview(userId = null) {
  requireGhostDuelEnabled();
  seedNearDailyChallenges();
  const db = openDb();
  const resolved = resolveYesterdayGhostPool(db);
  const base = {
    featureEnabled: true,
    cost: GHOST_DUEL_COST,
    label: GHOST_LABEL,
  };
  if (!resolved.ok) {
    return {
      ...base,
      available: false,
      reason: resolved.code,
      message: resolved.message,
      sourceDate: resolved.date,
      challengeId: resolved.challengeId || null,
      ghost: null,
      ghosts: [],
      poolSource: null,
    };
  }
  const ghostsPublic = resolved.ghosts.map(publicGhostIdentity);
  const out = {
    ...base,
    available: true,
    reason: null,
    message: null,
    sourceDate: resolved.date,
    challengeId: resolved.challenge.id,
    ghost: ghostsPublic[0],
    ghosts: ghostsPublic,
    poolSource: resolved.poolSource,
  };
  if (userId) {
    out.balance = getJiuCoinBalance(userId, db);
    const active = db
      .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
      .get(userId);
    out.cloudActiveGame = active ? sessionPublicFromRow(active) : null;
  }
  return out;
}

function expireStaleActive(db, userId, nowIso) {
  db.prepare(
    `UPDATE game_sessions SET status = 'expired'
     WHERE user_id = ? AND status = 'active' AND expires_at < ?`
  ).run(userId, nowIso);
}

/**
 * Start or resume a ghost duel on yesterday's challenge window.
 * Does NOT touch daily_challenge_attempts / today's chance.
 * @param {number} userId
 * @param {{ createKey?: string, ghostGameId?: string|null }} [opts]
 */
export function startGhostDuel(userId, { createKey: clientKey, ghostGameId } = {}) {
  requireGhostDuelEnabled();
  if (!config.cloudGamesEnabled) {
    return {
      error: {
        status: 403,
        code: "CLOUD_GAMES_DISABLED",
        message: "当前暂停新建云端对局（已有对局仍可完成结算）",
      },
    };
  }
  seedNearDailyChallenges();
  const now = challengeNow();
  const nowIso = now.toISOString();
  const db = openDb();
  const resolved = resolveYesterdayGhostPool(db, now);
  if (!resolved.ok) {
    return {
      error: {
        status: resolved.code === "NO_REPLAY" ? 409 : 404,
        code: resolved.code,
        message: resolved.message,
        details: { sourceDate: resolved.date, challengeId: resolved.challengeId || null },
      },
    };
  }

  const picked = pickGhostFromPool(resolved, ghostGameId);
  if (!picked.ok) {
    return {
      error: {
        status: 404,
        code: picked.code,
        message: picked.message,
        details: {
          sourceDate: resolved.date,
          challengeId: resolved.challenge.id,
          ghostGameId: ghostGameId != null ? String(ghostGameId) : null,
        },
      },
    };
  }
  const { challenge } = resolved;
  const ghost = picked.ghost;

  const createKey =
    clientKey && typeof clientKey === "string" && clientKey.length >= 8 && clientKey.length <= 128
      ? clientKey
      : `ghost-duel:${challenge.id}:${ghost.gameId}:${userId}:${crypto.randomUUID()}`;

  const byKey = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
    .get(userId, createKey);
  if (byKey) {
    return {
      status: 200,
      data: {
        game: sessionPublicFromRow(byKey),
        resumed: true,
        charged: false,
        ghost: publicGhostIdentity(ghostPayloadIdentity(byKey) || ghost),
      },
    };
  }

  expireStaleActive(db, userId, nowIso);
  const active = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  if (active) {
    return {
      error: {
        status: 409,
        code: "ACTIVE_GAME_EXISTS",
        message: "已有进行中的云端对局，请先继续或明确放弃后再挑战幽灵",
        details: {
          gameId: active.id,
          game: sessionPublicFromRow(active),
        },
      },
    };
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const modifiersJson = ghostModifiersJson(ghost, {
    sourceChallengeId: challenge.id,
    sourceChallengeDate: resolved.date,
  });
  const payloadHash = sha256Text(
    JSON.stringify({
      kind: "ghost",
      challengeId: challenge.id,
      ghostGameId: ghost.gameId,
      fillMode: DAILY_FILL_MODE,
      marketHash: challenge.market_hash,
    })
  );

  try {
    const tx = db.transaction(() => {
      expireStaleActive(db, userId, nowIso);
      const againActive = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (againActive) {
        const err = new Error("ACTIVE_GAME_EXISTS");
        err.code = "ACTIVE_GAME_EXISTS";
        err.activeGame = sessionPublicFromRow(againActive);
        throw err;
      }

      db.prepare(
        `INSERT INTO game_sessions (
          id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
          fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
          game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
          game_kind, protocol_version, revision, undo_count, assist_class, challenge_id,
          canonical_actions_json, modifiers
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, 0, ?, ?, NULL, ?)`
      ).run(
        id,
        userId,
        createKey,
        payloadHash,
        challenge.rule_version,
        challenge.dataset_version,
        DAILY_FILL_MODE,
        challenge.stock_code,
        challenge.stock_name,
        challenge.stock_index,
        challenge.window_start,
        challenge.history_length,
        challenge.game_days,
        challenge.snapshot_json,
        challenge.snapshot_sha256,
        nowIso,
        expiresAt,
        GAME_KIND_GHOST,
        PROTOCOL_LEGACY_BATCH,
        ASSIST_LEGACY,
        challenge.id,
        modifiersJson
      );

      deductGameCreateCost(userId, id, db, GHOST_DUEL_COST);
    });
    tx();
  } catch (e) {
    if (e.code === "INSUFFICIENT_FUNDS") {
      return {
        error: {
          status: 402,
          code: "INSUFFICIENT_FUNDS",
          message: "韭币不足，无法挑战幽灵",
          details: { balance: e.balance ?? null, required: e.required ?? GHOST_DUEL_COST },
        },
      };
    }
    if (e.code === "ACTIVE_GAME_EXISTS") {
      return {
        error: {
          status: 409,
          code: "ACTIVE_GAME_EXISTS",
          message: "已有进行中的云端对局，请先继续或明确放弃后再挑战幽灵",
          details: { game: e.activeGame || null },
        },
      };
    }
    if (String(e.message || "").includes("UNIQUE") || e.code === "SQLITE_CONSTRAINT_UNIQUE") {
      const again = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (again) {
        return {
          status: 200,
          data: {
            game: sessionPublicFromRow(again),
            resumed: true,
            charged: false,
            ghost: publicGhostIdentity(ghostPayloadIdentity(again) || ghost),
          },
        };
      }
    }
    throw e;
  }

  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id);
  return {
    status: 201,
    data: {
      game: sessionPublicFromRow(row),
      resumed: false,
      charged: true,
      ghost: publicGhostIdentity(ghost),
    },
  };
}

function ghostPayloadIdentity(row) {
  if (!row?.modifiers) return null;
  try {
    const m = typeof row.modifiers === "string" ? JSON.parse(row.modifiers) : row.modifiers;
    const g = m?.ghost;
    if (!g) return null;
    return {
      gameId: g.gameId,
      nickname: g.nickname,
      avatarId: g.avatarId,
      avatarUrl: g.avatarUrl,
      label: GHOST_LABEL,
      returnPpm: g.returnPpm,
      userId: g.userId,
      sourceDate: g.sourceDate,
    };
  } catch {
    return null;
  }
}
