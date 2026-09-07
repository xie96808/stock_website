import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { pickRandomWindow, ensureDatasetLoaded, sha256Text } from "./dataset.js";
import { settleGame, RULE_VERSION, DECISION_DAYS, FILL_MODES } from "../../../shared/engine.js";

const FILL_SET = new Set(FILL_MODES);
const GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTION_SET = new Set(["buy", "sell", "hold"]);

function nowIso() {
  return new Date().toISOString();
}

function expiresIso(from = Date.now()) {
  return new Date(from + GAME_TTL_MS).toISOString();
}

export function hashPayload(obj) {
  return sha256Text(JSON.stringify(obj));
}

/**
 * Normalize finish actions into string[29].
 * Accepts ["buy",...] or [{day,action},...]
 */
export function normalizeActions(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_ACTIONS", message: "actions 必须是数组", status: 400 };
  }
  if (raw.length !== DECISION_DAYS) {
    return {
      ok: false,
      code: "INVALID_ACTIONS",
      message: `finish 需要恰好 ${DECISION_DAYS} 个动作`,
      status: 400,
      details: { got: raw.length },
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
      const keys = Object.keys(item);
      for (const k of keys) {
        if (k !== "day" && k !== "action") {
          return {
            ok: false,
            code: "INVALID_ACTIONS",
            message: "actions 含未知字段",
            status: 400,
            details: { day: i + 1, field: k },
          };
        }
      }
      if (day !== i + 1) {
        return {
          ok: false,
          code: "INVALID_ACTIONS",
          message: `第 ${i + 1} 日 day 字段必须为 ${i + 1}`,
          status: 400,
          details: { day: i + 1, got: day },
        };
      }
    } else {
      return {
        ok: false,
        code: "INVALID_ACTIONS",
        message: `第 ${i + 1} 日动作格式错误`,
        status: 400,
        details: { day: i + 1 },
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

function sessionPublic(row, { includeResult = false, result = null } = {}) {
  if (!row) return null;
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
  };
  if (includeResult && result) {
    return { ...base, ...resultDto(result, row) };
  }
  return base;
}

export function resultDto(resultRow, sessionRow) {
  const valuation = resultRow.valuation_json
    ? JSON.parse(resultRow.valuation_json)
    : null;
  const returnPpm = resultRow.return_ppm;
  const returnPct = (returnPpm / 10000).toFixed(2);
  return {
    gameId: resultRow.game_id,
    ruleVersion: sessionRow?.rule_version || RULE_VERSION,
    datasetVersion: sessionRow?.dataset_version,
    fillMode: sessionRow?.fill_mode,
    returnPpm,
    returnPct,
    tradeCount: resultRow.trade_count,
    equityMultiple: resultRow.equity_multiple_decimal,
    valuation,
    validationStatus: resultRow.validity,
    savedAt: resultRow.created_at,
    finishedAt: sessionRow?.finished_at || resultRow.created_at,
    stockCode: sessionRow?.stock_code,
    stockName: sessionRow?.stock_name,
    actions: JSON.parse(resultRow.actions_json),
    trades: JSON.parse(resultRow.trades_json),
  };
}

function expireStaleActive(db, userId, now = nowIso()) {
  db.prepare(
    `UPDATE game_sessions SET status = 'expired'
     WHERE user_id = ? AND status = 'active' AND expires_at < ?`
  ).run(userId, now);
}

export function getActiveGame(userId) {
  const db = openDb();
  expireStaleActive(db, userId);
  const row = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  return sessionPublic(row);
}

/**
 * Create a cloud game. opts may include pick overrides for tests.
 */
export function createGame(userId, { fillMode, createKey, pickOpts = {} }) {
  if (!FILL_SET.has(fillMode)) {
    return { error: { status: 400, code: "INVALID_FILL_MODE", message: "fillMode 无效" } };
  }
  if (!createKey || typeof createKey !== "string" || createKey.length < 8 || createKey.length > 128) {
    return {
      error: { status: 400, code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key 必填（8-128）" },
    };
  }

  ensureDatasetLoaded();
  const payloadHash = hashPayload({ fillMode });
  const db = openDb();
  const now = nowIso();

  const existing = db
    .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
    .get(userId, createKey);
  if (existing) {
    if (existing.create_payload_hash !== payloadHash) {
      return {
        error: {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "同一幂等键不能用于不同开局参数",
        },
      };
    }
    return { status: 200, data: sessionPublic(existing) };
  }

  let picked;
  try {
    picked = pickRandomWindow(pickOpts);
  } catch (e) {
    return {
      error: { status: 503, code: "DATASET_UNAVAILABLE", message: String(e.message || e) },
    };
  }

  const id = crypto.randomUUID();
  const expiresAt = expiresIso(Date.parse(now));

  try {
    const tx = db.transaction(() => {
      expireStaleActive(db, userId, now);
      const active = db
        .prepare(`SELECT id FROM game_sessions WHERE user_id = ? AND status = 'active'`)
        .get(userId);
      if (active) {
        const err = new Error("ACTIVE_GAME_EXISTS");
        err.code = "ACTIVE_GAME_EXISTS";
        err.activeId = active.id;
        throw err;
      }
      db.prepare(
        `INSERT INTO game_sessions (
          id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
          fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
          game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(
        id,
        userId,
        createKey,
        payloadHash,
        picked.ruleVersion,
        picked.datasetVersion,
        fillMode,
        picked.stockCode,
        picked.stockName,
        picked.stockIndex,
        picked.windowStartIndex,
        picked.historyLength,
        picked.gameDays,
        picked.snapshotJson,
        picked.snapshotSha256,
        now,
        expiresAt
      );
    });
    tx();
  } catch (e) {
    if (e.code === "ACTIVE_GAME_EXISTS") {
      return {
        error: {
          status: 409,
          code: "ACTIVE_GAME_EXISTS",
          message: "已有进行中的云端对局，请先结算或放弃",
          details: { gameId: e.activeId },
        },
      };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const again = db
        .prepare(`SELECT * FROM game_sessions WHERE user_id = ? AND create_key = ?`)
        .get(userId, createKey);
      if (again && again.create_payload_hash === payloadHash) {
        return { status: 200, data: sessionPublic(again) };
      }
      return {
        error: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "幂等冲突" },
      };
    }
    throw e;
  }

  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id);
  return { status: 201, data: sessionPublic(row) };
}

export function abandonGame(userId, gameId) {
  const db = openDb();
  const now = nowIso();
  expireStaleActive(db, userId, now);
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }
  if (row.status === "abandoned") {
    return { status: 204 };
  }
  if (row.status === "settled") {
    return {
      error: { status: 409, code: "ALREADY_SETTLED", message: "已结算对局不能放弃" },
    };
  }
  if (row.status === "expired") {
    return { status: 204 };
  }
  if (row.status !== "active") {
    return {
      error: { status: 409, code: "INVALID_STATUS", message: "当前状态不可放弃" },
    };
  }
  db.prepare(
    `UPDATE game_sessions SET status = 'abandoned', finished_at = ? WHERE id = ? AND status = 'active'`
  ).run(now, gameId);
  return { status: 204 };
}

export function finishGame(userId, gameId, body) {
  const norm = normalizeActions(body?.actions);
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
    return {
      error: { status: 400, code: "FINISH_REQUIRED", message: "finish 必须为 true" },
    };
  }

  const actions = norm.actions;
  const submissionHash = hashPayload({ actions, finish: true });
  const db = openDb();
  const now = nowIso();

  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }

  // Settled identical retry (even if past expires_at)
  if (row.status === "settled") {
    const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
    if (!existing) {
      return {
        error: { status: 500, code: "INTERNAL", message: "结算记录缺失" },
      };
    }
    if (existing.submission_hash !== submissionHash) {
      return {
        error: {
          status: 409,
          code: "SUBMISSION_CONFLICT",
          message: "该局已结算，不能提交不同动作",
        },
      };
    }
    return { status: 200, data: resultDto(existing, row) };
  }

  if (row.status === "abandoned" || row.status === "expired") {
    return {
      error: {
        status: 409,
        code: "GAME_NOT_ACTIVE",
        message: "对局已结束，无法结算",
      },
    };
  }

  if (row.status !== "active") {
    return {
      error: { status: 409, code: "INVALID_STATUS", message: "对局状态不可结算" },
    };
  }

  // Expire check for unsettled
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`UPDATE game_sessions SET status = 'expired' WHERE id = ? AND status = 'active'`).run(
      gameId
    );
    return {
      error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期，无法结算" },
    };
  }

  const snapshot = JSON.parse(row.snapshot_json);
  const bars = snapshot.bars;
  // Replay outside write lock intent: compute first, then short tx
  const replay = settleGame({
    fillMode: row.fill_mode,
    bars,
    actions,
  });
  if (!replay.ok) {
    return {
      error: {
        status: 422,
        code: "INVALID_ACTION_SEQUENCE",
        message: replay.message || "动作序列非法",
        details: { day: replay.day, position: replay.position },
      },
    };
  }

  const equityStr =
    typeof replay.equityMultiple === "number"
      ? String(replay.equityMultiple)
      : String(replay.equityMultiple);

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
      if (Date.parse(fresh.expires_at) <= Date.now()) {
        db.prepare(`UPDATE game_sessions SET status = 'expired' WHERE id = ?`).run(gameId);
        const err = new Error("GAME_EXPIRED");
        err.code = "GAME_EXPIRED";
        throw err;
      }

      db.prepare(
        `INSERT INTO game_results (
          game_id, submission_hash, actions_json, trades_json, return_ppm,
          equity_multiple_decimal, trade_count, valuation_json, validity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid')`
      ).run(
        gameId,
        submissionHash,
        JSON.stringify(actions),
        JSON.stringify(replay.trades),
        replay.returnPpm,
        equityStr,
        replay.tradeCount,
        replay.valuation ? JSON.stringify(replay.valuation) : null
      );
      db.prepare(
        `UPDATE game_sessions SET status = 'settled', finished_at = ? WHERE id = ?`
      ).run(now, gameId);
    });
    tx();
  } catch (e) {
    if (e.code === "IDEMPOTENT_HIT") {
      return { status: 200, data: resultDto(e.existing, e.session) };
    }
    if (e.code === "SUBMISSION_CONFLICT") {
      return {
        error: {
          status: 409,
          code: "SUBMISSION_CONFLICT",
          message: "该局已结算，不能提交不同动作",
        },
      };
    }
    if (e.code === "GAME_EXPIRED") {
      return {
        error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期，无法结算" },
      };
    }
    if (e.code === "NOT_FOUND") {
      return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
    }
    if (e.code === "GAME_NOT_ACTIVE") {
      return {
        error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局已结束，无法结算" },
      };
    }
    // UNIQUE on game_results PK under race
    if (String(e.message || "").includes("UNIQUE")) {
      const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
      const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (existing && existing.submission_hash === submissionHash) {
        return { status: 200, data: resultDto(existing, sess) };
      }
      return {
        error: {
          status: 409,
          code: "SUBMISSION_CONFLICT",
          message: "该局已结算，不能提交不同动作",
        },
      };
    }
    throw e;
  }

  const result = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
  const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  return { status: 201, data: resultDto(result, sess) };
}

export function getGameForOwner(userId, gameId) {
  const db = openDb();
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }
  if (row.status === "settled") {
    const result = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
    return { status: 200, data: sessionPublic(row, { includeResult: true, result }) };
  }
  return { status: 200, data: sessionPublic(row) };
}

function encodeCursor(finishedAt, id) {
  return Buffer.from(JSON.stringify({ finishedAt, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const o = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!o || typeof o.finishedAt !== "string" || typeof o.id !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

export function listMyGames(userId, query = {}) {
  const db = openDb();
  ensureDatasetLoaded();
  const meta = ensureDatasetLoaded();
  const fillMode = query.fillMode || null;
  const ruleVersion = query.ruleVersion || RULE_VERSION;
  const datasetVersion = query.datasetVersion || meta.version;
  let limit = Number(query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const params = [userId, ruleVersion, datasetVersion];
  let sql = `
    SELECT s.*, r.return_ppm, r.trade_count, r.equity_multiple_decimal, r.valuation_json,
           r.validity, r.created_at AS result_created_at, r.actions_json, r.trades_json, r.game_id
    FROM game_sessions s
    JOIN game_results r ON r.game_id = s.id
    WHERE s.user_id = ? AND s.status = 'settled'
      AND s.rule_version = ? AND s.dataset_version = ?
      AND r.validity = 'valid'
  `;
  if (fillMode) {
    if (!FILL_SET.has(fillMode)) {
      return {
        error: { status: 400, code: "INVALID_FILL_MODE", message: "fillMode 无效" },
      };
    }
    sql += ` AND s.fill_mode = ?`;
    params.push(fillMode);
  }

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    if (!c) {
      return { error: { status: 400, code: "INVALID_CURSOR", message: "游标无效" } };
    }
    sql += ` AND (s.finished_at < ? OR (s.finished_at = ? AND s.id < ?))`;
    params.push(c.finishedAt, c.finishedAt, c.id);
  }

  sql += ` ORDER BY s.finished_at DESC, s.id DESC LIMIT ?`;
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((row) => {
    const result = {
      game_id: row.game_id || row.id,
      return_ppm: row.return_ppm,
      trade_count: row.trade_count,
      equity_multiple_decimal: row.equity_multiple_decimal,
      valuation_json: row.valuation_json,
      validity: row.validity,
      created_at: row.result_created_at,
      actions_json: row.actions_json,
      trades_json: row.trades_json,
    };
    return resultDto(result, row);
  });
  let nextCursor = null;
  if (hasMore && page.length) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor(last.finished_at, last.id);
  }
  return {
    status: 200,
    data: {
      items,
      nextCursor,
      filters: { fillMode: fillMode || null, ruleVersion, datasetVersion },
    },
  };
}

export function myStats(userId, query = {}) {
  const db = openDb();
  const meta = ensureDatasetLoaded();
  const fillMode = query.fillMode || null;
  const ruleVersion = query.ruleVersion || RULE_VERSION;
  const datasetVersion = query.datasetVersion || meta.version;

  const params = [userId, ruleVersion, datasetVersion];
  let sql = `
    SELECT r.return_ppm
    FROM game_sessions s
    JOIN game_results r ON r.game_id = s.id
    WHERE s.user_id = ? AND s.status = 'settled'
      AND s.rule_version = ? AND s.dataset_version = ?
      AND r.validity = 'valid'
  `;
  if (fillMode) {
    if (!FILL_SET.has(fillMode)) {
      return {
        error: { status: 400, code: "INVALID_FILL_MODE", message: "fillMode 无效" },
      };
    }
    sql += ` AND s.fill_mode = ?`;
    params.push(fillMode);
  }

  const rows = db.prepare(sql).all(...params);
  const count = rows.length;
  if (count === 0) {
    return {
      status: 200,
      data: {
        count: 0,
        bestReturnPpm: null,
        bestReturnPct: null,
        avgReturnPpm: null,
        avgReturnPct: null,
        winCount: 0,
        winRate: null,
        filters: { fillMode: fillMode || null, ruleVersion, datasetVersion },
      },
    };
  }
  let best = rows[0].return_ppm;
  let sum = 0;
  let wins = 0;
  for (const r of rows) {
    const p = r.return_ppm;
    sum += p;
    if (p > best) best = p;
    if (p > 0) wins += 1;
  }
  const avg = Math.round(sum / count); // display rounding of arithmetic mean of ppm
  // Spec: 平均 = 各局 return_ppm 的算术平均，显示前才舍入
  const avgExact = sum / count;
  const avgPpm = Math.round(avgExact); // half? use round half up via engine? keep Math.round for mean
  return {
    status: 200,
    data: {
      count,
      bestReturnPpm: best,
      bestReturnPct: (best / 10000).toFixed(2),
      avgReturnPpm: avgPpm,
      avgReturnPct: (avgPpm / 10000).toFixed(2),
      winCount: wins,
      winRate: Number(((wins / count) * 100).toFixed(2)),
      filters: { fillMode: fillMode || null, ruleVersion, datasetVersion },
    },
  };
}

/** Test helper: backdate expires_at */
export function backdateExpiresAt(gameId, iso) {
  openDb().prepare(`UPDATE game_sessions SET expires_at = ? WHERE id = ?`).run(iso, gameId);
}

export function countResults(gameId) {
  return openDb().prepare(`SELECT COUNT(*) AS c FROM game_results WHERE game_id = ?`).get(gameId).c;
}

export function getSessionRow(gameId) {
  return openDb().prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
}
