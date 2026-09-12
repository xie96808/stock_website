/**
 * F01 每日同题挑战 — server logic (flag default OFF).
 * Locked rules: docs/daily-challenge-f01.md / PRD §4.1.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import {
  ensureDatasetLoaded,
  pickRandomWindow,
  sha256Text,
} from "./dataset.js";
import { deductGameCreateCost, shanghaiYmd, getJiuCoinBalance } from "./jiuCoin.js";
import { settleCurveMetrics } from "../../../shared/equityCurve.js";
import { RULE_VERSION, INITIAL_CASH, GAME_DAYS } from "../../../shared/rules.js";
import {
  GAME_KIND_DAILY,
  PROTOCOL_LEGACY_BATCH,
  ASSIST_LEGACY,
} from "../../../shared/protocol.js";

/** Local session DTO — avoid circular import with games.js */
function sessionPublicFromRow(row) {
  if (!row) return null;
  return {
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
    challengeId: row.challenge_id || null,
    protocolVersion: row.protocol_version || "legacy-batch",
    undoCount: row.undo_count ?? 0,
  };
}

/** Decoupled from classic create cost (20). Challenge-only fee. */
export const DAILY_CHALLENGE_COST = 50;
export const DAILY_FILL_MODE = "next_open";

/** Inject wall clock for tests via STOCKGAME_NOW_MS (epoch ms). */
export function challengeNow(date = null) {
  if (date instanceof Date) return date;
  const raw = process.env.STOCKGAME_NOW_MS;
  if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
    return new Date(Number(raw));
  }
  return new Date();
}

export function requireDailyChallengeEnabled() {
  if (!config.dailyChallengeEnabled) {
    const err = new Error("每日挑战暂未开放");
    err.code = "DAILY_CHALLENGE_DISABLED";
    err.status = 404;
    throw err;
  }
}

/** Asia/Shanghai calendar YYYY-MM-DD for a Date. */
export function shanghaiYmdAt(date = challengeNow()) {
  return shanghaiYmd(date);
}

/** Next Shanghai calendar date after ymd. */
export function nextShanghaiYmd(ymd) {
  const ms = Date.parse(`${ymd}T12:00:00+08:00`) + 24 * 60 * 60 * 1000;
  return shanghaiYmd(new Date(ms));
}

export function shanghaiDayOpensAt(ymd) {
  return new Date(Date.parse(`${ymd}T00:00:00+08:00`)).toISOString();
}

/** Ranking cutoff = next Shanghai day 00:00:00. */
export function shanghaiDayClosesAt(ymd) {
  return shanghaiDayOpensAt(nextShanghaiYmd(ymd));
}

function challengeIdForDate(ymd) {
  return `daily:${ymd}`;
}

function officialCreateKey(challengeId) {
  return `daily-official:${challengeId}`;
}

/** Relative day offsets seeded around "today" so QA always has near-term content. */
const SEED_DAY_OFFSETS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/**
 * Frozen pick intents (stockIndex + window). Materialized against the active pack
 * once; snapshot is then immutable even if the default dataset later changes.
 */
const SEED_PICK_INTENTS = [
  { stockIndex: 0, windowStartIndex: 30 },
  { stockIndex: 1, windowStartIndex: 32 },
  { stockIndex: 0, windowStartIndex: 40 },
  { stockIndex: 1, windowStartIndex: 45 },
  { stockIndex: 0, windowStartIndex: 50 },
  { stockIndex: 1, windowStartIndex: 35 },
  { stockIndex: 0, windowStartIndex: 55 },
  { stockIndex: 1, windowStartIndex: 48 },
  { stockIndex: 0, windowStartIndex: 38 },
  { stockIndex: 1, windowStartIndex: 42 },
  { stockIndex: 0, windowStartIndex: 44 },
  { stockIndex: 1, windowStartIndex: 52 },
  { stockIndex: 0, windowStartIndex: 36 },
  { stockIndex: 1, windowStartIndex: 58 },
];

function ymdPlusOffset(baseYmd, offsetDays) {
  const ms = Date.parse(`${baseYmd}T12:00:00+08:00`) + offsetDays * 24 * 60 * 60 * 1000;
  return shanghaiYmd(new Date(ms));
}

function tryPick(intent) {
  try {
    return pickRandomWindow({
      stockIndex: intent.stockIndex,
      windowStartIndex: intent.windowStartIndex,
    });
  } catch {
    return null;
  }
}

function pickForSeedSlot(slotIndex) {
  ensureDatasetLoaded();
  const intent = SEED_PICK_INTENTS[slotIndex % SEED_PICK_INTENTS.length];
  let picked = tryPick(intent);
  if (picked) return picked;
  // Fallback: any eligible window (still frozen into row once written).
  return pickRandomWindow({
    rng: () => {
      // Deterministic-ish from slot so all servers agree for same pack.
      let x = (slotIndex + 1) * 2654435761;
      x = Math.imul(x ^ (x >>> 16), 2246822507);
      return ((x >>> 0) % 10000) / 10000;
    },
  });
}

/**
 * Ensure ≥14 published daily configs around the current Shanghai day.
 * Safe to call repeatedly; never rewrites an existing row (immutable snapshot).
 */
export function seedNearDailyChallenges(now = challengeNow()) {
  ensureDatasetLoaded();
  const db = openDb();
  const today = shanghaiYmdAt(now);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO daily_challenges (
      id, challenge_date, opens_at, closes_at, fill_mode, initial_cash,
      rule_version, dataset_version, stock_code, stock_name, stock_index,
      window_start, history_length, game_days, snapshot_json, snapshot_sha256,
      market_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`
  );

  let created = 0;
  const tx = db.transaction(() => {
    for (let i = 0; i < SEED_DAY_OFFSETS.length; i++) {
      const ymd = ymdPlusOffset(today, SEED_DAY_OFFSETS[i]);
      const id = challengeIdForDate(ymd);
      const existing = db.prepare(`SELECT id FROM daily_challenges WHERE id = ?`).get(id);
      if (existing) continue;
      const picked = pickForSeedSlot(i);
      const marketHash = picked.snapshotSha256;
      insert.run(
        id,
        ymd,
        shanghaiDayOpensAt(ymd),
        shanghaiDayClosesAt(ymd),
        DAILY_FILL_MODE,
        INITIAL_CASH,
        picked.ruleVersion || RULE_VERSION,
        picked.datasetVersion,
        picked.stockCode,
        picked.stockName,
        picked.stockIndex,
        picked.windowStartIndex,
        picked.historyLength,
        picked.gameDays || GAME_DAYS,
        picked.snapshotJson,
        picked.snapshotSha256,
        marketHash
      );
      created += 1;
    }
  });
  tx();
  return { created, today };
}

export function getChallengeByDate(ymd, db = openDb()) {
  return db.prepare(`SELECT * FROM daily_challenges WHERE challenge_date = ?`).get(ymd) || null;
}

export function getChallengeById(id, db = openDb()) {
  return db.prepare(`SELECT * FROM daily_challenges WHERE id = ?`).get(id) || null;
}

function attemptForUser(userId, challengeId, db = openDb()) {
  return (
    db
      .prepare(`SELECT * FROM daily_challenge_attempts WHERE user_id = ? AND challenge_id = ?`)
      .get(userId, challengeId) || null
  );
}

function expireStaleActive(db, userId, nowIso) {
  db.prepare(
    `UPDATE game_sessions SET status = 'expired'
     WHERE user_id = ? AND status = 'active' AND expires_at < ?`
  ).run(userId, nowIso);
  // Mirror attempt status for daily games that just expired.
  db.prepare(
    `UPDATE daily_challenge_attempts
     SET status = 'expired'
     WHERE user_id = ? AND status = 'active'
       AND game_id IN (
         SELECT id FROM game_sessions WHERE user_id = ? AND status = 'expired'
       )`
  ).run(userId, userId);
}

function publicChallengeSummary(row, { redactIdentity = true } = {}) {
  if (!row) return null;
  const base = {
    challengeId: row.id,
    date: row.challenge_date,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    fillMode: row.fill_mode,
    initialCash: row.initial_cash,
    ruleVersion: row.rule_version,
    gameDays: row.game_days,
    marketHash: row.market_hash,
    cost: DAILY_CHALLENGE_COST,
  };
  if (!redactIdentity) {
    base.stockCode = row.stock_code;
    base.stockName = row.stock_name;
    base.stockIndex = row.stock_index;
    base.windowStartIndex = row.window_start;
    base.historyLength = row.history_length;
    base.datasetVersion = row.dataset_version;
  }
  return base;
}

function isPastCutoff(challenge, now = challengeNow()) {
  return now.getTime() >= Date.parse(challenge.closes_at);
}

/**
 * Hub / status payload for a calendar day (default today).
 */
export function getDailyChallengeStatus(userId = null, { date = null } = {}) {
  requireDailyChallengeEnabled();
  seedNearDailyChallenges();
  const now = challengeNow();
  const ymd = date || shanghaiYmdAt(now);
  const db = openDb();
  const challenge = getChallengeByDate(ymd, db);
  if (!challenge) {
    return {
      ready: false,
      date: ymd,
      message: "今日挑战准备中",
      cost: DAILY_CHALLENGE_COST,
      remainingChance: userId ? 1 : null,
    };
  }

  const pastCutoff = isPastCutoff(challenge, now);
  const out = {
    ready: true,
    date: ymd,
    challenge: publicChallengeSummary(challenge, { redactIdentity: !pastCutoff }),
    pastCutoff,
    boardUnlocked: pastCutoff,
    cost: DAILY_CHALLENGE_COST,
    rules: {
      fillMode: DAILY_FILL_MODE,
      initialCash: INITIAL_CASH,
      gameDays: GAME_DAYS,
      officialAttemptsPerDay: 1,
      rewind: false,
      rankCoins: false,
    },
  };

  if (!userId) {
    out.remainingChance = null;
    out.attempt = null;
    out.activeGame = null;
    return out;
  }

  expireStaleActive(db, userId, now.toISOString());
  const attempt = attemptForUser(userId, challenge.id, db);
  if (!attempt) {
    out.remainingChance = 1;
    out.attempt = null;
    out.activeGame = null;
  } else {
    out.remainingChance = 0;
    const game = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(attempt.game_id);
    out.attempt = {
      attemptId: attempt.id,
      status: attempt.status,
      boardEligible: !!attempt.board_eligible,
      returnPpm: attempt.return_ppm,
      mddPpm: attempt.mdd_ppm,
      benchmarkReturnPpm: attempt.benchmark_return_ppm,
      settledAt: attempt.settled_at,
      gameId: attempt.game_id,
    };
    if (game && game.status === "active") {
      out.activeGame = sessionPublicFromRow(game);
    } else {
      out.activeGame = null;
    }
  }

  // Any active cloud game (classic or daily) for conflict UX.
  const active = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  out.cloudActiveGame = active ? sessionPublicFromRow(active) : null;
  out.balance = getJiuCoinBalance(userId, db);
  return out;
}

/**
 * Start or resume today's official daily challenge game.
 * Same TX: occupy chance + deduct 10 + create game.
 */
export function startDailyChallenge(userId, { createKey: clientKey } = {}) {
  requireDailyChallengeEnabled();
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
  const ymd = shanghaiYmdAt(now);
  const db = openDb();
  const challenge = getChallengeByDate(ymd, db);
  if (!challenge) {
    return {
      error: {
        status: 503,
        code: "CHALLENGE_NOT_READY",
        message: "今日挑战准备中",
      },
    };
  }

  const createKey =
    clientKey && typeof clientKey === "string" && clientKey.length >= 8 && clientKey.length <= 128
      ? clientKey
      : officialCreateKey(challenge.id);

  // Idempotent resume via create_key or existing attempt.
  const byKey = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
    .get(userId, createKey);
  if (byKey) {
    return { status: 200, data: { game: sessionPublicFromRow(byKey), resumed: true, charged: false } };
  }

  const existingAttempt = attemptForUser(userId, challenge.id, db);
  if (existingAttempt) {
    const game = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(existingAttempt.game_id);
    if (game && game.status === "active") {
      return {
        status: 200,
        data: { game: sessionPublicFromRow(game), resumed: true, charged: false },
      };
    }
    return {
      error: {
        status: 409,
        code: "DAILY_CHANCE_USED",
        message: "今日正式机会已使用（放弃/过期不退款，不可同日重开）",
        details: {
          attemptStatus: existingAttempt.status,
          gameId: existingAttempt.game_id,
          gameStatus: game?.status || null,
        },
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
        message: "已有进行中的云端对局，请先继续或明确放弃后再开今日挑战",
        details: {
          gameId: active.id,
          game: sessionPublicFromRow(active),
        },
      },
    };
  }

  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const payloadHash = sha256Text(
    JSON.stringify({
      kind: "daily",
      challengeId: challenge.id,
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
        err.activeId = againActive.id;
        err.activeGame = sessionPublicFromRow(againActive);
        throw err;
      }
      const againAttempt = attemptForUser(userId, challenge.id, db);
      if (againAttempt) {
        const err = new Error("DAILY_CHANCE_USED");
        err.code = "DAILY_CHANCE_USED";
        throw err;
      }

      db.prepare(
        `INSERT INTO game_sessions (
          id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
          fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
          game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
          game_kind, protocol_version, revision, undo_count, assist_class, challenge_id,
          canonical_actions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, 0, ?, ?, NULL)`
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
        GAME_KIND_DAILY,
        PROTOCOL_LEGACY_BATCH,
        ASSIST_LEGACY,
        challenge.id
      );

      deductGameCreateCost(userId, id, db, DAILY_CHALLENGE_COST);

      db.prepare(
        `INSERT INTO daily_challenge_attempts (
          id, challenge_id, challenge_date, user_id, game_id, status, board_eligible
        ) VALUES (?, ?, ?, ?, ?, 'active', 0)`
      ).run(attemptId, challenge.id, ymd, userId, id);
    });
    tx();
  } catch (e) {
    if (e.code === "INSUFFICIENT_FUNDS") {
      return {
        error: {
          status: 402,
          code: "INSUFFICIENT_FUNDS",
          message: "韭币不足，无法创建今日挑战",
          details: { balance: e.balance ?? null, required: e.required ?? DAILY_CHALLENGE_COST },
        },
      };
    }
    if (e.code === "ACTIVE_GAME_EXISTS") {
      return {
        error: {
          status: 409,
          code: "ACTIVE_GAME_EXISTS",
          message: "已有进行中的云端对局，请先继续或明确放弃后再开今日挑战",
          details: { gameId: e.activeId, game: e.activeGame || null },
        },
      };
    }
    if (e.code === "DAILY_CHANCE_USED") {
      return {
        error: {
          status: 409,
          code: "DAILY_CHANCE_USED",
          message: "今日正式机会已使用",
        },
      };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const game = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (game) {
        return { status: 200, data: { game: sessionPublicFromRow(game), resumed: true, charged: false } };
      }
      const att = attemptForUser(userId, challenge.id, db);
      if (att) {
        const g = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(att.game_id);
        if (g?.status === "active") {
          return { status: 200, data: { game: sessionPublicFromRow(g), resumed: true, charged: false } };
        }
        return {
          error: {
            status: 409,
            code: "DAILY_CHANCE_USED",
            message: "今日正式机会已使用",
          },
        };
      }
    }
    throw e;
  }

  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id);
  return {
    status: 201,
    data: { game: sessionPublicFromRow(row), resumed: false, charged: true },
  };
}

/**
 * Hook after a daily game settles (called from finishGame).
 * Returns board eligibility / late flag. Idempotent.
 */
export function onDailyGameSettled(db, sessionRow, resultRow, settledAtIso) {
  if (!sessionRow || sessionRow.game_kind !== GAME_KIND_DAILY) return null;
  const challengeId = sessionRow.challenge_id;
  if (!challengeId) return null;
  const challenge = getChallengeById(challengeId, db);
  const attempt = db
    .prepare(`SELECT * FROM daily_challenge_attempts WHERE game_id = ?`)
    .get(sessionRow.id);
  if (!attempt) return null;

  // Idempotent: already settled/late
  if (attempt.status === "settled" || attempt.status === "settle_late") {
    return {
      boardEligible: !!attempt.board_eligible,
      status: attempt.status,
      returnPpm: attempt.return_ppm,
      mddPpm: attempt.mdd_ppm,
    };
  }

  // Cutoff uses injectable challenge clock (STOCKGAME_NOW_MS), not wall DB timestamp.
  const cutoffMs = challenge ? Date.parse(challenge.closes_at) : 0;
  const onTime = challenge && challengeNow().getTime() < cutoffMs;
  const status = onTime ? "settled" : "settle_late";
  const boardEligible = onTime ? 1 : 0;

  db.prepare(
    `UPDATE daily_challenge_attempts
     SET status = ?, board_eligible = ?, return_ppm = ?, mdd_ppm = ?,
         benchmark_return_ppm = ?, settled_at = ?
     WHERE id = ? AND status = 'active'`
  ).run(
    status,
    boardEligible,
    resultRow.return_ppm,
    resultRow.mdd_ppm,
    resultRow.benchmark_return_ppm,
    settledAtIso,
    attempt.id
  );

  return {
    boardEligible: !!boardEligible,
    status,
    returnPpm: resultRow.return_ppm,
    mddPpm: resultRow.mdd_ppm,
  };
}

/** Sync attempt when daily game is abandoned / expired without settle. */
export function onDailyGameClosed(db, sessionRow, status) {
  if (!sessionRow || sessionRow.game_kind !== GAME_KIND_DAILY) return;
  if (status !== "abandoned" && status !== "expired") return;
  db.prepare(
    `UPDATE daily_challenge_attempts
     SET status = ?
     WHERE game_id = ? AND status = 'active'`
  ).run(status, sessionRow.id);
}

/**
 * Day leaderboard. Pre-cutoff: summary only (no stock identity / curve / actions).
 */
export function getDailyLeaderboard({ date = null, limit = 50 } = {}) {
  requireDailyChallengeEnabled();
  seedNearDailyChallenges();
  const now = challengeNow();
  const ymd = date || shanghaiYmdAt(now);
  const db = openDb();
  const challenge = getChallengeByDate(ymd, db);
  if (!challenge) {
    return {
      ready: false,
      date: ymd,
      message: "今日挑战准备中",
      entries: [],
      total: 0,
    };
  }
  const pastCutoff = isPastCutoff(challenge, now);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const rows = db
    .prepare(
      `SELECT
         a.user_id AS user_id,
         a.game_id AS game_id,
         a.return_ppm AS return_ppm,
         a.mdd_ppm AS mdd_ppm,
         a.benchmark_return_ppm AS benchmark_return_ppm,
         a.settled_at AS settled_at,
         u.nickname AS nickname,
         u.avatar_id AS avatar_id,
         u.avatar_custom_path AS avatar_custom_path,
         DENSE_RANK() OVER (
           ORDER BY a.return_ppm DESC, a.mdd_ppm ASC, a.settled_at ASC, a.user_id ASC
         ) AS rank
       FROM daily_challenge_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.challenge_id = ?
         AND a.board_eligible = 1
         AND a.status = 'settled'
         AND u.status = 'active'
       ORDER BY a.return_ppm DESC, a.mdd_ppm ASC, a.settled_at ASC, a.user_id ASC
       LIMIT ?`
    )
    .all(challenge.id, lim);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM daily_challenge_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.challenge_id = ?
         AND a.board_eligible = 1
         AND a.status = 'settled'
         AND u.status = 'active'`
    )
    .get(challenge.id);

  const entries = rows.map((r) => {
    const custom = r.avatar_custom_path || null;
    const entry = {
      rank: r.rank,
      userId: r.user_id,
      nickname: r.nickname,
      avatarId: r.avatar_id,
      avatarCustomPath: custom,
      // Same pattern as classic leaderboard: custom CDN path or null (client falls back to preset).
      avatarUrl: custom ? `/api/v1/avatars/${custom}` : null,
      returnPpm: r.return_ppm,
      returnPct: (r.return_ppm / 10000).toFixed(2),
      mddPpm: r.mdd_ppm,
      settledAt: r.settled_at,
    };
    if (pastCutoff) {
      entry.gameId = r.game_id;
      entry.benchmarkReturnPpm = r.benchmark_return_ppm;
      entry.stockCode = challenge.stock_code;
      entry.stockName = challenge.stock_name;
    }
    return entry;
  });

  return {
    ready: true,
    date: ymd,
    challengeId: challenge.id,
    pastCutoff,
    boardUnlocked: pastCutoff,
    fillMode: DAILY_FILL_MODE,
    total: Number(totalRow?.c) || 0,
    entries,
    challenge: publicChallengeSummary(challenge, { redactIdentity: !pastCutoff }),
  };
}

/** Compute curve metrics for a daily settle (reuse B0-PR2 helpers). */
export function dailySettleMetrics(sessionRow, actions) {
  const snapshot = JSON.parse(sessionRow.snapshot_json);
  return settleCurveMetrics({
    fillMode: sessionRow.fill_mode || DAILY_FILL_MODE,
    bars: snapshot.bars,
    actions,
  });
}
