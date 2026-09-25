/**
 * F02 残局挑战 (ch1…ch4) — server logic (flag default OFF).
 * Locked rules: docs/puzzle-chapter-f02.md / PRD §4.3.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { ensureDatasetLoaded, sha256Text } from "./dataset.js";
import { buildGameWindowDto } from "./gameWindowDto.js";
import { grantRewardClaim } from "./rewardClaims.js";
import {
  GAME_KIND_PUZZLE,
  PROTOCOL_LEGACY_BATCH,
  ASSIST_LEGACY,
} from "../../../shared/protocol.js";
import {
  PUZZLE_RULE_VERSION,
  PUZZLE_FILL_MODE,
  settlePuzzle,
  puzzleBuyHoldBenchmarkPpm,
  scorePuzzleStars,
  puzzleActionErrorZh,
  formatReturnPct,
  PUZZLE_ACTIONS,
} from "../../../shared/puzzleEngine.js";
import {
  PUZZLE_CHAPTER_ID,
  PUZZLE_CHAPTER2_ID,
  PUZZLE_CHAPTER3_ID,
  PUZZLE_CHAPTER4_ID,
  PUZZLE_FIRST_CLEAR_REWARD,
  PUZZLE_CHAPTER_MAX_REWARD,
  PUZZLE_CREATE_FEE,
  PUZZLE_RETRY_FEE,
  PUZZLE_THREE_STAR_REWARD,
  PUZZLE_PUBLIC_STOCK_CODE,
  buildLevelSnapshot,
  puzzleVersionId,
  firstClearRewardKey,
  threeStarRewardKey,
  levelDefByKey,
  levelDefsForChapter,
  chapterTitle,
} from "./puzzleLevels.js";
import { deductGameCreateCost, getJiuCoinBalance } from "./jiuCoin.js";
import { challengeNow } from "./dailyChallenge.js";
import { findActiveEngagement } from "./activeEngagement.js";

const ACTION_SET = new Set(PUZZLE_ACTIONS);

export {
  PUZZLE_CHAPTER_ID,
  PUZZLE_CHAPTER2_ID,
  PUZZLE_CHAPTER3_ID,
  PUZZLE_CHAPTER4_ID,
  PUZZLE_FIRST_CLEAR_REWARD,
  PUZZLE_CHAPTER_MAX_REWARD,
  PUZZLE_CREATE_FEE,
  PUZZLE_RETRY_FEE,
  PUZZLE_THREE_STAR_REWARD,
  firstClearRewardKey,
  threeStarRewardKey,
  chapterTitle,
};

export function requirePuzzleChapterEnabled() {
  if (!config.puzzleChapterEnabled) {
    const err = new Error("残局挑战暂未开放");
    err.code = "PUZZLE_CHAPTER_DISABLED";
    err.status = 404;
    throw err;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function gameConflictDetails(gameId, game) {
  const details = { gameId, game: game || null };
  if (config.intradayModeEnabled) {
    details.kind = game?.gameKind || "puzzle";
    details.sessionId = gameId;
  }
  return details;
}

function expireStaleActive(db, userId, now) {
  db.prepare(
    `UPDATE game_sessions SET status = 'expired'
     WHERE user_id = ? AND status = 'active' AND expires_at <= ?`
  ).run(userId, now);
}

function sessionPublicFromRow(row) {
  if (!row) return null;
  let initialState = null;
  let goals = null;
  let maxOrders = null;
  let bars = null;
  let history = null;
  let snapHistoryLength = null;
  let snapLevelKey = null;
  try {
    const snap = JSON.parse(row.snapshot_json);
    initialState = snap.initialState || (row.initial_state_json ? JSON.parse(row.initial_state_json) : null);
    goals = snap.goals || null;
    maxOrders = snap.maxOrders ?? null;
    bars = Array.isArray(snap.bars) ? snap.bars : null;
    history = Array.isArray(snap.history) ? snap.history : [];
    snapHistoryLength =
      Number.isInteger(snap.historyLength) ? snap.historyLength : (history ? history.length : 0);
    if (typeof snap.levelKey === "string") snapLevelKey = snap.levelKey;
  } catch {
    /* ignore */
  }
  if (!initialState && row.initial_state_json) {
    try {
      initialState = JSON.parse(row.initial_state_json);
    } catch {
      /* ignore */
    }
  }
  const historyLength =
    snapHistoryLength != null ? snapHistoryLength : (row.history_length ?? 0);
  let levelKey = snapLevelKey;
  if (!levelKey && row.puzzle_version_id) {
    const m = String(row.puzzle_version_id).match(/^puzzle:([^:]+):/);
    if (m) levelKey = m[1];
  }
  // Authored copy (not seed-frozen snapshot) — same source as GET /puzzles list.
  const authored = levelKey ? levelDefByKey(levelKey) : null;
  const out = {
    gameId: row.id,
    ruleVersion: row.rule_version,
    datasetVersion: row.dataset_version,
    fillMode: row.fill_mode,
    stockIndex: row.stock_index,
    windowStartIndex: row.window_start,
    historyLength,
    gameDays: row.game_days,
    stockCode: PUZZLE_PUBLIC_STOCK_CODE,
    stockName: row.stock_name,
    status: row.status,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at || null,
    gameKind: row.game_kind || GAME_KIND_PUZZLE,
    puzzleVersionId: row.puzzle_version_id || null,
    levelKey,
    title: authored?.title || null,
    theme: authored?.theme || null,
    protocolVersion: row.protocol_version || PROTOCOL_LEGACY_BATCH,
    undoCount: row.undo_count ?? 0,
    createFee: PUZZLE_CREATE_FEE,
    initialState,
    goals,
    maxOrders,
    teachingBrief: authored?.teachingBrief || null,
    openStateHint: authored?.openStateHint || null,
    decisionDays: (row.game_days || 0) - 1,
    // Client feeds #gameScreen K-line from snapshot (short synthetic window; not pack slice).
    bars,
    history: history || [],
  };
  try {
    const snap = JSON.parse(row.snapshot_json);
    const win = buildGameWindowDto(snap);
    if (win) out.window = win;
  } catch {
    /* ignore */
  }
  return out;
}

/** Seed published levels for one chapter (idempotent on version id). */
export function seedPuzzleChapter(chapterId, db = openDb()) {
  ensureDatasetLoaded();
  const defs = levelDefsForChapter(chapterId);
  let created = 0;
  let skipped = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO puzzle_versions (
      id, chapter_id, level_index, level_key, reward_family_id, version,
      title, theme, status, rule_version, fill_mode, game_days, max_orders,
      stock_code, stock_name, stock_index, window_start, history_length,
      snapshot_json, snapshot_sha256, initial_state_json, goals_json, content_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const def of defs) {
      const id = puzzleVersionId(def);
      const { snapshot, snapshotJson, snapshotSha256 } = buildLevelSnapshot(def);
      const histLen = Number.isInteger(snapshot.historyLength)
        ? snapshot.historyLength
        : (Array.isArray(snapshot.history) ? snapshot.history.length : 0);
      const info = insert.run(
        id,
        chapterId,
        def.levelIndex,
        def.levelKey,
        def.rewardFamilyId,
        def.version,
        def.title,
        def.theme,
        def.status || "published",
        PUZZLE_RULE_VERSION,
        PUZZLE_FILL_MODE,
        def.gameDays,
        def.maxOrders,
        def.stockCode || PUZZLE_PUBLIC_STOCK_CODE,
        def.stockName,
        snapshot.stockIndex ?? def.stockIndex ?? -1,
        snapshot.windowStartIndex ?? def.windowStart ?? -1,
        histLen,
        snapshotJson,
        snapshotSha256,
        JSON.stringify(def.initialState),
        JSON.stringify(def.goals),
        def.contentNote || null
      );
      if (info.changes > 0) created += 1;
      else skipped += 1;
    }
  });
  tx();
  return { created, skipped, total: defs.length, chapterId };
}

/** Seed / upsert published chapter-1 levels (idempotent on version id). */
export function seedPuzzleChapter1(db = openDb()) {
  return seedPuzzleChapter(PUZZLE_CHAPTER_ID, db);
}

/** Seed / upsert published chapter-2 levels (idempotent on version id). */
export function seedPuzzleChapter2(db = openDb()) {
  return seedPuzzleChapter(PUZZLE_CHAPTER2_ID, db);
}

/** Seed / upsert published chapter-3 levels (idempotent on version id). */
export function seedPuzzleChapter3(db = openDb()) {
  return seedPuzzleChapter(PUZZLE_CHAPTER3_ID, db);
}

/** Seed / upsert published chapter-4 levels (idempotent on version id). */
export function seedPuzzleChapter4(db = openDb()) {
  return seedPuzzleChapter(PUZZLE_CHAPTER4_ID, db);
}

/** Seed all authored chapters when flag is on. */
export function seedAllPuzzleChapters(db = openDb()) {
  const ch1 = seedPuzzleChapter1(db);
  const ch2 = seedPuzzleChapter2(db);
  const ch3 = seedPuzzleChapter3(db);
  const ch4 = seedPuzzleChapter4(db);
  return { ch1, ch2, ch3, ch4 };
}

function latestPublishedLevels(chapterId, db) {
  return db
    .prepare(
      `SELECT pv.* FROM puzzle_versions pv
       INNER JOIN (
         SELECT level_key, MAX(version) AS max_version
         FROM puzzle_versions
         WHERE chapter_id = ? AND status = 'published'
         GROUP BY level_key
       ) latest
         ON pv.level_key = latest.level_key AND pv.version = latest.max_version
       WHERE pv.chapter_id = ? AND pv.status = 'published'
       ORDER BY pv.level_index ASC`
    )
    .all(chapterId, chapterId);
}

function progressForUser(userId, chapterId, db) {
  if (!userId) return new Map();
  const rows = db
    .prepare(
      `SELECT * FROM puzzle_progress WHERE user_id = ? AND chapter_id = ?`
    )
    .all(userId, chapterId);
  return new Map(rows.map((r) => [r.level_key, r]));
}

function chapterRewardGrantedCount(userId, chapterId, db) {
  const rows = db
    .prepare(
      `SELECT reward_key FROM reward_claims WHERE user_id = ? AND reward_key LIKE 'puzzle:first-clear:%'`
    )
    .all(userId);
  // Cap is per chapter families (ch1-01… / ch4-01…); do not mix chapters.
  const prefix = `puzzle:first-clear:${chapterId}-`;
  return rows.filter((r) => String(r.reward_key).startsWith(prefix)).length;
}


function hasSettledForFamily(userId, rewardFamilyId, db) {
  if (!userId || !rewardFamilyId) return false;
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM game_sessions gs
       JOIN puzzle_versions pv ON pv.id = gs.puzzle_version_id
       WHERE gs.user_id = ?
         AND gs.game_kind = ?
         AND gs.status = 'settled'
         AND pv.reward_family_id = ?
       LIMIT 1`
    )
    .get(userId, GAME_KIND_PUZZLE, rewardFamilyId);
  return !!row;
}

/** Fee for a *new* entry: free until first settled run on family; then retry fee. */
export function puzzleEntryFeeForFamily(userId, rewardFamilyId, db = openDb()) {
  return hasSettledForFamily(userId, rewardFamilyId, db) ? PUZZLE_RETRY_FEE : PUZZLE_CREATE_FEE;
}

export function listPuzzleChapter(userId = null, { chapterId = PUZZLE_CHAPTER_ID } = {}) {
  requirePuzzleChapterEnabled();
  seedAllPuzzleChapters();
  const db = openDb();
  const levels = latestPublishedLevels(chapterId, db);
  if (!levels.length) {
    return {
      chapterId,
      status: "preparing",
      message: "残局章节准备中",
      levels: [],
      reward: {
        firstClearAmount: PUZZLE_FIRST_CLEAR_REWARD,
        threeStarAmount: PUZZLE_THREE_STAR_REWARD,
        chapterMax: PUZZLE_CHAPTER_MAX_REWARD,
        grantedCount: 0,
        retryFee: PUZZLE_RETRY_FEE,
      },
      retryFee: PUZZLE_RETRY_FEE,
    };
  }
  const prog = progressForUser(userId, chapterId, db);
  const grantedCount = userId ? chapterRewardGrantedCount(userId, chapterId, db) : 0;
  return {
    chapterId,
    status: "ready",
    title: chapterTitle(chapterId),
    createFee: PUZZLE_CREATE_FEE,
    retryFee: PUZZLE_RETRY_FEE,
    threeStarReward: PUZZLE_THREE_STAR_REWARD,
    rewindEnabled: false,
    levels: levels.map((row) => {
      const p = prog.get(row.level_key);
      let goals = null;
      try {
        goals = JSON.parse(row.goals_json);
      } catch {
        goals = null;
      }
      const authored = levelDefByKey(row.level_key);
      return {
        levelKey: row.level_key,
        levelIndex: row.level_index,
        puzzleVersionId: row.id,
        rewardFamilyId: row.reward_family_id,
        version: row.version,
        title: row.title,
        theme: row.theme,
        status: row.status,
        gameDays: row.game_days,
        decisionDays: row.game_days - 1,
        maxOrders: row.max_orders,
        goals,
        teachingBrief: authored?.teachingBrief || null,
        openStateHint: authored?.openStateHint || null,
        contentNote: row.content_note,
        progress: p
          ? {
              bestStars: p.best_stars,
              bestReturnPpm: p.best_return_ppm,
              bestMddPpm: p.best_mdd_ppm,
              firstTwoStarAt: p.first_two_star_at,
              lastPlayedAt: p.last_played_at,
            }
          : {
              bestStars: 0,
              bestReturnPpm: null,
              bestMddPpm: null,
              firstTwoStarAt: null,
              lastPlayedAt: null,
            },
        firstClearGranted: userId
          ? !!db
              .prepare(
                `SELECT 1 AS ok FROM reward_claims WHERE user_id = ? AND reward_key = ?`
              )
              .get(userId, firstClearRewardKey(row.reward_family_id))
          : false,
        threeStarGranted: userId
          ? !!db
              .prepare(
                `SELECT 1 AS ok FROM reward_claims WHERE user_id = ? AND reward_key = ?`
              )
              .get(userId, threeStarRewardKey(row.reward_family_id))
          : false,
        entryFee: userId
          ? puzzleEntryFeeForFamily(userId, row.reward_family_id, db)
          : PUZZLE_CREATE_FEE,
      };
    }),
    reward: {
      firstClearAmount: PUZZLE_FIRST_CLEAR_REWARD,
      threeStarAmount: PUZZLE_THREE_STAR_REWARD,
      chapterMax: PUZZLE_CHAPTER_MAX_REWARD,
      grantedCount,
      retryFee: PUZZLE_RETRY_FEE,
    },
  };
}

function getLevelRow(levelKey, db = openDb()) {
  return db
    .prepare(
      `SELECT pv.* FROM puzzle_versions pv
       INNER JOIN (
         SELECT level_key, MAX(version) AS max_version
         FROM puzzle_versions
         WHERE level_key = ? AND status IN ('published', 'stub')
         GROUP BY level_key
       ) latest
         ON pv.level_key = latest.level_key AND pv.version = latest.max_version
       WHERE pv.level_key = ?`
    )
    .get(levelKey, levelKey);
}

export function startPuzzleEntry(userId, levelKey, { createKey: clientKey } = {}) {
  requirePuzzleChapterEnabled();
  if (!config.cloudGamesEnabled) {
    return {
      error: {
        status: 403,
        code: "CLOUD_GAMES_DISABLED",
        message: "当前暂停新建云端对局（已有对局仍可完成结算）",
      },
    };
  }
  seedAllPuzzleChapters();
  const db = openDb();
  const level = getLevelRow(levelKey, db);
  if (!level || level.status === "preparing") {
    return {
      error: {
        status: 503,
        code: "PUZZLE_NOT_READY",
        message: "该残局准备中",
      },
    };
  }
  if (level.status === "stub") {
    return {
      error: {
        status: 503,
        code: "PUZZLE_NOT_READY",
        message: "该残局仍为占位内容，暂不可开局",
      },
    };
  }

  const createKey =
    clientKey && typeof clientKey === "string" && clientKey.length >= 8 && clientKey.length <= 128
      ? clientKey
      : `puzzle:${level.level_key}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

  const byKey = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
    .get(userId, createKey);
  if (byKey) {
    return {
      status: 200,
      data: { game: sessionPublicFromRow(byKey), resumed: true, charged: false, createFee: 0 },
    };
  }

  // Resume any active puzzle for same level.
  const activeSame = db
    .prepare(
      `SELECT * FROM game_sessions
       WHERE user_id = ? AND status = 'active' AND game_kind = ? AND puzzle_version_id = ?`
    )
    .get(userId, GAME_KIND_PUZZLE, level.id);
  if (activeSame) {
    return {
      status: 200,
      data: { game: sessionPublicFromRow(activeSame), resumed: true, charged: false, createFee: 0 },
    };
  }

  const now = nowIso();
  expireStaleActive(db, userId, now);
  const active = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  if (active) {
    return {
      error: {
        status: 409,
        code: "ACTIVE_GAME_EXISTS",
        message: "已有进行中的云端对局，请先继续或明确放弃后再开残局",
        details: gameConflictDetails(active.id, sessionPublicFromRow(active)),
      },
    };
  }

  const { version: datasetVersion } = ensureDatasetLoaded();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const payloadHash = sha256Text(
    JSON.stringify({
      kind: "puzzle",
      puzzleVersionId: level.id,
      fillMode: level.fill_mode,
      snapshotSha: level.snapshot_sha256,
    })
  );

  const entryFee = puzzleEntryFeeForFamily(userId, level.reward_family_id, db);
  let charged = false;
  let balanceAfter = null;

  try {
    const tx = db.transaction(() => {
      expireStaleActive(db, userId, now);
      const again = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (again) {
        const err = new Error("ACTIVE_GAME_EXISTS");
        err.code = "ACTIVE_GAME_EXISTS";
        err.activeId = again.id;
        err.activeGame = sessionPublicFromRow(again);
        throw err;
      }
      if (config.intradayModeEnabled) {
        const intra = findActiveEngagement(db, userId, challengeNow().toISOString());
        if (intra) {
          const err = new Error("ACTIVE_INTRADAY");
          err.code = "ACTIVE_INTRADAY";
          err.sessionId = intra.sessionId;
          throw err;
        }
      }
      // First attempt (no prior settled run on family): free.
      // Retry after settled: deduct PUZZLE_RETRY_FEE via game_create ledger (idempotent per game id).
      if (entryFee > 0) {
        const debit = deductGameCreateCost(userId, id, db, entryFee);
        charged = !debit.unchanged;
        balanceAfter = debit.balance;
      }
      db.prepare(
        `INSERT INTO game_sessions (
          id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
          fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
          game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
          game_kind, protocol_version, revision, undo_count, assist_class,
          puzzle_version_id, initial_state_json, canonical_actions_json, economy_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, ?)`
      ).run(
        id,
        userId,
        createKey,
        payloadHash,
        level.rule_version,
        datasetVersion,
        level.fill_mode,
        level.stock_code,
        level.stock_name,
        level.stock_index,
        level.window_start,
        level.history_length,
        level.game_days,
        level.snapshot_json,
        level.snapshot_sha256,
        now,
        expiresAt,
        GAME_KIND_PUZZLE,
        PROTOCOL_LEGACY_BATCH,
        ASSIST_LEGACY,
        level.id,
        level.initial_state_json,
        "economy-v1"
      );
    });
    tx();
  } catch (e) {
    if (e.code === "ACTIVE_INTRADAY") {
      return {
        error: {
          status: 409,
          code: "ACTIVE_GAME_EXISTS",
          message: "已有进行中的分时对局，请先完成或放弃",
          details: { kind: "intraday", sessionId: e.sessionId },
        },
      };
    }
    if (e.code === "ACTIVE_GAME_EXISTS") {
      return {
        error: {
          status: 409,
          code: "ACTIVE_GAME_EXISTS",
          message: "已有进行中的云端对局，请先继续或明确放弃后再开残局",
          details: gameConflictDetails(e.activeId, e.activeGame),
        },
      };
    }
    if (e.code === "INSUFFICIENT_FUNDS") {
      return {
        error: {
          status: 402,
          code: "INSUFFICIENT_FUNDS",
          message: "韭币不足，无法重开残局",
          details: {
            balance: e.balance ?? getJiuCoinBalance(userId, db),
            required: e.required ?? entryFee,
            entryFee,
          },
        },
      };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const again = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (again) {
        return {
          status: 200,
          data: { game: sessionPublicFromRow(again), resumed: true, charged: false, createFee: 0 },
        };
      }
    }
    throw e;
  }

  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id);
  const game = sessionPublicFromRow(row);
  if (game) game.createFee = entryFee;
  return {
    status: 201,
    data: {
      game,
      resumed: false,
      charged,
      createFee: entryFee,
      balance: balanceAfter ?? getJiuCoinBalance(userId, db),
    },
  };
}

function normalizePuzzleActions(raw, decisionDays) {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_ACTIONS", message: "actions 必须是数组", status: 400 };
  }
  if (raw.length !== decisionDays) {
    return {
      ok: false,
      code: "INVALID_ACTIONS",
      message: `finish 需要恰好 ${decisionDays} 个动作`,
      status: 400,
      details: { got: raw.length, decisionDays },
    };
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    let action;
    let day;
    if (typeof item === "string") {
      action = item;
      day = i + 1;
    } else if (item && typeof item === "object") {
      action = item.action;
      day = item.day;
      if (day !== i + 1) {
        return {
          ok: false,
          code: "INVALID_ACTIONS",
          message: `第 ${i + 1} 日 day 字段必须为 ${i + 1}`,
          status: 400,
        };
      }
    } else {
      return {
        ok: false,
        code: "INVALID_ACTIONS",
        message: `第 ${i + 1} 日动作格式错误`,
        status: 400,
      };
    }
    if (!ACTION_SET.has(action)) {
      return {
        ok: false,
        code: "INVALID_ACTIONS",
        message: `第 ${i + 1} 日动作非法`,
        status: 400,
        details: { day: i + 1, action },
      };
    }
    out.push(action);
  }
  return { ok: true, actions: out };
}

/**
 * Settle a puzzle game: stars + optional first 2★ grant (idempotent by reward family).
 */
export function finishPuzzleGame(userId, gameId, body) {
  requirePuzzleChapterEnabled();
  const db = openDb();
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }
  if (row.game_kind !== GAME_KIND_PUZZLE) {
    return { error: { status: 400, code: "NOT_PUZZLE", message: "非残局对局" } };
  }

  const decisionDays = row.game_days - 1;
  const norm = normalizePuzzleActions(body?.actions, decisionDays);
  if (!norm.ok) {
    return {
      error: {
        status: norm.status,
        code: norm.code,
        message: norm.message,
        details: norm.details,
      },
    };
  }
  if (body?.finish !== true) {
    return { error: { status: 400, code: "FINISH_REQUIRED", message: "finish 必须为 true" } };
  }

  const actions = norm.actions;
  const submissionHash = sha256Text(JSON.stringify({ actions, finish: true, kind: "puzzle" }));

  if (row.status === "settled") {
    const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
    if (!existing) {
      return { error: { status: 500, code: "INTERNAL", message: "结算记录缺失" } };
    }
    if (existing.submission_hash !== submissionHash) {
      return {
        error: { status: 409, code: "SUBMISSION_CONFLICT", message: "该局已结算，不能提交不同动作" },
      };
    }
    return { status: 200, data: buildPuzzleResultDto(db, existing, row) };
  }

  if (row.status !== "active") {
    return { error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局已结束，无法结算" } };
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`UPDATE game_sessions SET status = 'expired' WHERE id = ? AND status = 'active'`).run(
      gameId
    );
    return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期，无法结算" } };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return { error: { status: 500, code: "INTERNAL", message: "快照损坏" } };
  }
  const initialState = snapshot.initialState || JSON.parse(row.initial_state_json);
  const maxOrders = snapshot.maxOrders ?? null;
  const goals = snapshot.goals || JSON.parse(
    db.prepare(`SELECT goals_json FROM puzzle_versions WHERE id = ?`).get(row.puzzle_version_id)
      ?.goals_json || "{}"
  );

  const replay = settlePuzzle({
    fillMode: row.fill_mode,
    bars: snapshot.bars,
    actions,
    initialState,
    maxOrders,
  });
  if (!replay.ok) {
    return {
      error: {
        status: 422,
        code: "INVALID_ACTION_SEQUENCE",
        message: puzzleActionErrorZh(replay.message) || "动作序列非法",
        details: {
          day: replay.day,
          rejected: !!replay.rejected,
          stateUnchanged: !!replay.stateUnchanged,
          engineMessage: replay.message || null,
        },
      },
    };
  }

  const benchmarkReturnPpm = puzzleBuyHoldBenchmarkPpm({
    bars: snapshot.bars,
    initialState,
  });
  const starInfo = scorePuzzleStars({
    returnPpm: replay.returnPpm,
    mddPpm: replay.mddPpm,
    orderCount: replay.orderCount,
    benchmarkReturnPpm,
    goals,
  });

  const levelMeta = db
    .prepare(`SELECT * FROM puzzle_versions WHERE id = ?`)
    .get(row.puzzle_version_id);
  const rewardFamilyId = levelMeta?.reward_family_id;
  const levelKey = levelMeta?.level_key;
  const chapterId = levelMeta?.chapter_id || PUZZLE_CHAPTER_ID;
  const rewardKey = firstClearRewardKey(rewardFamilyId);
  const now = nowIso();

  let grantResult = null;
  let grantedThisTime = false;
  let threeStarGrantResult = null;
  let threeStarGrantedThisTime = false;

  try {
    const tx = db.transaction(() => {
      const fresh = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (!fresh || fresh.user_id !== userId) {
        const err = new Error("NOT_FOUND");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (fresh.status === "settled") {
        const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
        if (existing && existing.submission_hash === submissionHash) {
          const err = new Error("IDEMPOTENT_HIT");
          err.code = "IDEMPOTENT_HIT";
          err.existing = existing;
          err.session = fresh;
          throw err;
        }
        const err = new Error("SUBMISSION_CONFLICT");
        err.code = "SUBMISSION_CONFLICT";
        throw err;
      }
      if (fresh.status !== "active") {
        const err = new Error("GAME_NOT_ACTIVE");
        err.code = "GAME_NOT_ACTIVE";
        throw err;
      }

      const equityCurve = (replay.equityCash || []).map((equity, day) => ({
        day,
        equity: Math.round(equity),
      }));

      db.prepare(
        `INSERT INTO game_results (
          game_id, submission_hash, actions_json, trades_json, return_ppm,
          equity_multiple_decimal, trade_count, valuation_json, validity,
          mdd_ppm, benchmark_return_ppm, equity_curve_json, score_version, assist_class
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?, ?, ?, ?)`
      ).run(
        gameId,
        submissionHash,
        JSON.stringify(actions),
        JSON.stringify(replay.trades),
        replay.returnPpm,
        String(replay.finalEquity / replay.takeoverNav),
        replay.tradeCount,
        replay.valuation ? JSON.stringify(replay.valuation) : null,
        replay.mddPpm,
        benchmarkReturnPpm,
        JSON.stringify(equityCurve),
        "puzzle-mtm-curve-v1",
        ASSIST_LEGACY
      );
      db.prepare(
        `UPDATE game_sessions SET status = 'settled', finished_at = ?, canonical_actions_json = ? WHERE id = ?`
      ).run(now, JSON.stringify(actions), gameId);

      // Progress: higher stars update record only.
      const prev = db
        .prepare(
          `SELECT * FROM puzzle_progress WHERE user_id = ? AND level_key = ?`
        )
        .get(userId, levelKey);

      const bestStars = Math.max(prev?.best_stars || 0, starInfo.stars);
      const firstTwo =
        prev?.first_two_star_at ||
        (starInfo.stars >= 2 ? now : null);

      db.prepare(
        `INSERT INTO puzzle_progress (
          user_id, chapter_id, level_key, reward_family_id, best_stars,
          best_return_ppm, best_mdd_ppm, best_order_count, first_two_star_at,
          last_played_at, last_puzzle_version_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, level_key) DO UPDATE SET
          best_stars = excluded.best_stars,
          best_return_ppm = CASE
            WHEN excluded.best_stars > puzzle_progress.best_stars THEN excluded.best_return_ppm
            WHEN excluded.best_stars = puzzle_progress.best_stars
              AND (puzzle_progress.best_return_ppm IS NULL OR excluded.best_return_ppm > puzzle_progress.best_return_ppm)
              THEN excluded.best_return_ppm
            ELSE puzzle_progress.best_return_ppm
          END,
          best_mdd_ppm = CASE
            WHEN excluded.best_stars >= puzzle_progress.best_stars THEN excluded.best_mdd_ppm
            ELSE puzzle_progress.best_mdd_ppm
          END,
          best_order_count = excluded.best_order_count,
          first_two_star_at = COALESCE(puzzle_progress.first_two_star_at, excluded.first_two_star_at),
          last_played_at = excluded.last_played_at,
          last_puzzle_version_id = excluded.last_puzzle_version_id,
          updated_at = excluded.updated_at`
      ).run(
        userId,
        chapterId,
        levelKey,
        rewardFamilyId,
        bestStars,
        replay.returnPpm,
        replay.mddPpm,
        replay.orderCount,
        firstTwo,
        now,
        row.puzzle_version_id,
        now,
        now
      );

      // First 2★ grant — once per reward family; chapter cap 120 (=6*20).
      if (starInfo.stars >= 2 && rewardFamilyId) {
        const already = db
          .prepare(
            `SELECT 1 AS ok FROM reward_claims WHERE user_id = ? AND reward_key = ?`
          )
          .get(userId, rewardKey);
        if (!already) {
          const grantedFamilies = chapterRewardGrantedCount(userId, chapterId, db);
          if (grantedFamilies < PUZZLE_CHAPTER_MAX_REWARD / PUZZLE_FIRST_CLEAR_REWARD) {
            grantResult = grantRewardClaim(db, {
              userId,
              rewardKey,
              amount: PUZZLE_FIRST_CLEAR_REWARD,
              reason: "puzzle_first_clear",
              ruleVersion: PUZZLE_RULE_VERSION,
              refType: "puzzle_version",
              refId: row.puzzle_version_id,
              meta: {
                levelKey,
                rewardFamilyId,
                stars: starInfo.stars,
                chapterId,
              },
            });
            grantedThisTime = !grantResult.unchanged;
          }
        }
      }

      // First 3★ bonus — once per family; independent of 2★ first-clear / chapter cap.
      if (starInfo.stars >= 3 && rewardFamilyId) {
        const threeKey = threeStarRewardKey(rewardFamilyId);
        const alreadyThree = db
          .prepare(
            `SELECT 1 AS ok FROM reward_claims WHERE user_id = ? AND reward_key = ?`
          )
          .get(userId, threeKey);
        if (!alreadyThree) {
          threeStarGrantResult = grantRewardClaim(db, {
            userId,
            rewardKey: threeKey,
            amount: PUZZLE_THREE_STAR_REWARD,
            reason: "puzzle_three_star",
            ruleVersion: PUZZLE_RULE_VERSION,
            refType: "puzzle_version",
            refId: row.puzzle_version_id,
            meta: {
              levelKey,
              rewardFamilyId,
              stars: starInfo.stars,
              chapterId,
            },
          });
          threeStarGrantedThisTime = !threeStarGrantResult.unchanged;
        }
      }
    });
    tx();
  } catch (e) {
    if (e.code === "IDEMPOTENT_HIT") {
      return { status: 200, data: buildPuzzleResultDto(db, e.existing, e.session) };
    }
    if (e.code === "SUBMISSION_CONFLICT") {
      return {
        error: { status: 409, code: "SUBMISSION_CONFLICT", message: "该局已结算，不能提交不同动作" },
      };
    }
    if (e.code === "NOT_FOUND") {
      return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
    }
    if (e.code === "GAME_NOT_ACTIVE") {
      return { error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局已结束，无法结算" } };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
      const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (existing && existing.submission_hash === submissionHash) {
        return { status: 200, data: buildPuzzleResultDto(db, existing, sess) };
      }
      return {
        error: { status: 409, code: "SUBMISSION_CONFLICT", message: "该局已结算，不能提交不同动作" },
      };
    }
    throw e;
  }

  const result = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
  const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  const dto = buildPuzzleResultDto(db, result, sess, {
    stars: starInfo.stars,
    twoStarMet: starInfo.twoStarMet,
    threeStarMet: starInfo.threeStarMet,
    edgePpm: starInfo.edgePpm,
    goals,
    rewardGranted: grantedThisTime,
    rewardAmount: grantedThisTime ? PUZZLE_FIRST_CLEAR_REWARD : 0,
    rewardKey,
    grantUnchanged: grantResult?.unchanged ?? null,
    threeStarRewardGranted: threeStarGrantedThisTime,
    threeStarRewardAmount: threeStarGrantedThisTime ? PUZZLE_THREE_STAR_REWARD : 0,
    threeStarRewardKey: rewardFamilyId ? threeStarRewardKey(rewardFamilyId) : null,
  });
  return { status: 201, data: dto };
}

function buildPuzzleResultDto(db, resultRow, sessionRow, extra = null) {
  const level = sessionRow.puzzle_version_id
    ? db.prepare(`SELECT * FROM puzzle_versions WHERE id = ?`).get(sessionRow.puzzle_version_id)
    : null;
  const prog = level
    ? db
        .prepare(`SELECT * FROM puzzle_progress WHERE user_id = ? AND level_key = ?`)
        .get(sessionRow.user_id, level.level_key)
    : null;
  const rewardKey = level ? firstClearRewardKey(level.reward_family_id) : null;
  const threeKey = level ? threeStarRewardKey(level.reward_family_id) : null;
  const claim = rewardKey
    ? db
        .prepare(
          `SELECT amount, created_at FROM reward_claims WHERE user_id = ? AND reward_key = ?`
        )
        .get(sessionRow.user_id, rewardKey)
    : null;
  const threeClaim = threeKey
    ? db
        .prepare(
          `SELECT amount, created_at FROM reward_claims WHERE user_id = ? AND reward_key = ?`
        )
        .get(sessionRow.user_id, threeKey)
    : null;

  let stars = extra?.stars;
  let goals = extra?.goals;
  if (stars == null && resultRow) {
    // Recompute for idempotent replay responses.
    try {
      const snap = JSON.parse(sessionRow.snapshot_json);
      const actions = JSON.parse(resultRow.actions_json);
      const replay = settlePuzzle({
        bars: snap.bars,
        actions,
        initialState: snap.initialState,
        maxOrders: snap.maxOrders,
      });
      const bh = puzzleBuyHoldBenchmarkPpm({
        bars: snap.bars,
        initialState: snap.initialState,
      });
      goals = snap.goals;
      const s = scorePuzzleStars({
        returnPpm: replay.returnPpm,
        mddPpm: replay.mddPpm,
        orderCount: replay.orderCount,
        benchmarkReturnPpm: bh,
        goals,
      });
      stars = s.stars;
      extra = {
        ...(extra || {}),
        stars: s.stars,
        twoStarMet: s.twoStarMet,
        threeStarMet: s.threeStarMet,
        edgePpm: s.edgePpm,
        goals,
      };
    } catch {
      stars = prog?.best_stars ?? 1;
    }
  }

  const authored = level?.level_key ? levelDefByKey(level.level_key) : null;
  return {
    gameId: sessionRow.id,
    gameKind: GAME_KIND_PUZZLE,
    levelKey: level?.level_key || null,
    puzzleVersionId: sessionRow.puzzle_version_id,
    rewardFamilyId: level?.reward_family_id || null,
    title: authored?.title || level?.title || null,
    theme: authored?.theme || level?.theme || null,
    teachingBrief: authored?.teachingBrief || null,
    openStateHint: authored?.openStateHint || null,
    returnPpm: resultRow.return_ppm,
    returnPct: formatReturnPct(resultRow.return_ppm),
    mddPpm: resultRow.mdd_ppm,
    benchmarkReturnPpm: resultRow.benchmark_return_ppm,
    tradeCount: resultRow.trade_count,
    stars: stars ?? 1,
    twoStarMet: extra?.twoStarMet ?? (stars >= 2),
    threeStarMet: extra?.threeStarMet ?? (stars >= 3),
    edgePpm: extra?.edgePpm ?? null,
    goals: goals || extra?.goals || null,
    bestStars: prog?.best_stars ?? stars ?? 0,
    reward: {
      key: rewardKey,
      grantedThisTime: !!extra?.rewardGranted,
      amount: extra?.rewardAmount || 0,
      alreadyClaimed: !!claim,
      claimAmount: claim?.amount ?? null,
    },
    threeStarReward: {
      key: threeKey,
      grantedThisTime: !!extra?.threeStarRewardGranted,
      amount: extra?.threeStarRewardAmount || 0,
      alreadyClaimed: !!threeClaim,
      claimAmount: threeClaim?.amount ?? null,
    },
    entryFee: puzzleEntryFeeForFamily(
      sessionRow.user_id,
      level?.reward_family_id,
      db
    ),
    createFee: 0,
  };
}

/** Test helper: bump level version while keeping reward_family_id. */
export function insertLevelVersionBump(levelKey, db = openDb()) {
  const cur = getLevelRow(levelKey, db);
  if (!cur) throw new Error("level missing");
  const nextVer = cur.version + 1;
  const newId = `puzzle:${levelKey}:v${nextVer}`;
  db.prepare(
    `INSERT INTO puzzle_versions (
      id, chapter_id, level_index, level_key, reward_family_id, version,
      title, theme, status, rule_version, fill_mode, game_days, max_orders,
      stock_code, stock_name, stock_index, window_start, history_length,
      snapshot_json, snapshot_sha256, initial_state_json, goals_json, content_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    cur.chapter_id,
    cur.level_index,
    cur.level_key,
    cur.reward_family_id,
    nextVer,
    cur.title,
    cur.theme,
    "published",
    cur.rule_version,
    cur.fill_mode,
    cur.game_days,
    cur.max_orders,
    cur.stock_code,
    cur.stock_name,
    cur.stock_index,
    cur.window_start,
    cur.history_length,
    cur.snapshot_json,
    cur.snapshot_sha256,
    cur.initial_state_json,
    cur.goals_json,
    "version bump keeps reward_family_id"
  );
  return newId;
}
