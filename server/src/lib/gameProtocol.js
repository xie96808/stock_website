/**
 * B0 event-v1 protocol: state read, decision advance, server-side finish.
 * Legacy batch finish stays in games.js.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { sha256Text } from "./dataset.js";
import { replayGame, settleGame, DECISION_DAYS, GAME_DAYS } from "../../../shared/engine.js";
import {
  PROTOCOL_EVENT_V1,
  PROTOCOL_LEGACY_BATCH,
  DECISION_ACTION_SET,
  ASSIST_CLEAN,
  GAME_KIND_CLASSIC,
  SCORE_VERSION_CURVE_V1,
} from "../../../shared/protocol.js";
import {
  settleCurveMetrics,
  revealedGameDay,
} from "../../../shared/equityCurve.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";
import { resultDto } from "./gameResultDto.js";
import { JIU_COIN_GAME_REWIND_COST } from "./jiuCoin.js";

function hashPayload(obj) {
  return sha256Text(JSON.stringify(obj));
}

function parseActionsJson(raw) {
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function expireIfNeeded(db, row) {
  if (!row || row.status !== "active") return row;
  if (Date.parse(row.expires_at) > Date.now()) return row;
  db.prepare(`UPDATE game_sessions SET status = 'expired' WHERE id = ? AND status = 'active'`).run(
    row.id
  );
  return db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(row.id);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Visible market slice for event-v1: history + revealed game bars only.
 * Never includes stock identity or future bars.
 */
export function buildVisibleMarket(snapshot, actionCount, gameDays = GAME_DAYS) {
  if (!snapshot || !Array.isArray(snapshot.bars)) return null;
  const revealedDay = revealedGameDay(actionCount, gameDays);
  return {
    historyLength: snapshot.historyLength ?? (snapshot.history ? snapshot.history.length : 0),
    history: Array.isArray(snapshot.history) ? snapshot.history : [],
    revealedDay,
    bars: snapshot.bars.slice(0, revealedDay),
  };
}


function sessionCanRewind(row) {
  if (!config.gameRewindEnabled) return false;
  if (!row || row.status !== "active") return false;
  if (row.protocol_version !== PROTOCOL_EVENT_V1) return false;
  if ((row.game_kind || GAME_KIND_CLASSIC) !== GAME_KIND_CLASSIC) return false;
  if ((row.undo_count ?? 0) >= 1) return false;
  const actions = parseActionsJson(row.canonical_actions_json);
  return actions.length >= 1 && actions.length <= DECISION_DAYS;
}

/**
 * State DTO for owners. event-v1 omits identity / future bars.
 */
export function buildStateDto(row) {
  const actions = parseActionsJson(row.canonical_actions_json);
  const decisionDay = Math.min(actions.length + 1, DECISION_DAYS);
  const readyToSettle = actions.length >= DECISION_DAYS && row.status === "active";
  const protocolVersion = row.protocol_version || PROTOCOL_LEGACY_BATCH;
  const revealedDay = revealedGameDay(actions.length, row.game_days || GAME_DAYS);

  const dto = {
    gameId: row.id,
    protocolVersion,
    gameKind: row.game_kind || GAME_KIND_CLASSIC,
    revision: row.revision ?? 0,
    undoCount: row.undo_count ?? 0,
    assistClass: row.assist_class || "legacy",
    status: row.status,
    readyToSettle,
    fillMode: row.fill_mode,
    ruleVersion: row.rule_version,
    datasetVersion: row.dataset_version,
    historyLength: row.history_length,
    gameDays: row.game_days,
    actions,
    nextDecisionDay: row.status === "active" && !readyToSettle ? decisionDay : null,
    revealedDay,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at || null,
    canRewind: sessionCanRewind(row),
    rewindCost: JIU_COIN_GAME_REWIND_COST,
  };

  if (protocolVersion === PROTOCOL_EVENT_V1) {
    try {
      const snapshot = JSON.parse(row.snapshot_json);
      dto.visible = buildVisibleMarket(snapshot, actions.length, row.game_days || GAME_DAYS);
    } catch {
      dto.visible = null;
    }
    // Identity only after settle (result / owner get paths expose code/name).
    if (row.status === "settled") {
      dto.stockCode = row.stock_code;
      dto.stockName = row.stock_name;
    }
  }

  return dto;
}

export function getGameState(userId, gameId) {
  const db = openDb();
  let row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }
  row = expireIfNeeded(db, row);
  return { status: 200, data: buildStateDto(row) };
}

/**
 * Append one buy/sell/hold when EVENT_PROTOCOL_ENABLED and session is event-v1.
 */
export function appendDecision(userId, gameId, body, commandKey) {
  if (!config.protocolEventV1Enabled) {
    return {
      error: {
        status: 403,
        code: "EVENT_PROTOCOL_DISABLED",
        message: "事件协议未启用",
      },
    };
  }
  if (!commandKey || typeof commandKey !== "string" || commandKey.length < 8 || commandKey.length > 128) {
    return {
      error: {
        status: 400,
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key 必填（8-128）",
      },
    };
  }

  const action = body?.action;
  const expectedRevision = body?.expectedRevision;
  if (!DECISION_ACTION_SET.has(action)) {
    return {
      error: { status: 400, code: "INVALID_ACTION", message: "action 必须是 buy/sell/hold" },
    };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return {
      error: {
        status: 400,
        code: "INVALID_REVISION",
        message: "expectedRevision 必须是非负整数",
      },
    };
  }

  const payloadHash = hashPayload({ expectedRevision, action });
  const db = openDb();

  const existingCmd = db
    .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND command_key = ?`)
    .get(gameId, commandKey);
  if (existingCmd) {
    if (existingCmd.payload_hash !== payloadHash) {
      return {
        error: {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "同一幂等键不能用于不同决策负载",
        },
      };
    }
    if (existingCmd.response_json) {
      try {
        return { status: 200, data: JSON.parse(existingCmd.response_json) };
      } catch {
        /* fall through */
      }
    }
    const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
    return { status: 200, data: buildStateDto(row) };
  }

  let row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }
  row = expireIfNeeded(db, row);

  if (row.status === "expired") {
    return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期" } };
  }
  if (row.status !== "active") {
    return {
      error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局不在进行中" },
    };
  }
  if (row.protocol_version !== PROTOCOL_EVENT_V1) {
    return {
      error: {
        status: 409,
        code: "PROTOCOL_UNSUPPORTED",
        message: "该局不是 event-v1 协议，请走批量 finish",
        details: { protocolVersion: row.protocol_version },
      },
    };
  }
  if (row.revision !== expectedRevision) {
    return {
      error: {
        status: 409,
        code: "REVISION_CONFLICT",
        message: "revision 不匹配，请重新拉取状态",
        details: { expected: expectedRevision, actual: row.revision },
      },
    };
  }

  const prevActions = parseActionsJson(row.canonical_actions_json);
  if (prevActions.length >= DECISION_DAYS) {
    return {
      error: {
        status: 409,
        code: "READY_TO_SETTLE",
        message: "已完成全部决策日，请结算",
        details: { actionCount: prevActions.length },
      },
    };
  }

  const nextActions = [...prevActions, action];
  const snapshot = JSON.parse(row.snapshot_json);
  const replay = replayGame({
    fillMode: row.fill_mode,
    bars: snapshot.bars,
    actions: nextActions,
    finish: false,
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

  const revisionBefore = row.revision;
  const revisionAfter = revisionBefore + 1;
  const commandId = crypto.randomUUID();
  const eventJson = JSON.stringify({ type: "advance", action, day: nextActions.length });

  try {
    const tx = db.transaction(() => {
      const fresh = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (!fresh || fresh.user_id !== userId || fresh.status !== "active") {
        const err = new Error("GAME_NOT_ACTIVE");
        err.code = "GAME_NOT_ACTIVE";
        throw err;
      }
      if (fresh.revision !== expectedRevision) {
        const err = new Error("REVISION_CONFLICT");
        err.code = "REVISION_CONFLICT";
        err.actual = fresh.revision;
        throw err;
      }
      const again = db
        .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND command_key = ?`)
        .get(gameId, commandKey);
      if (again) {
        const err = new Error("IDEMPOTENCY_HIT");
        err.code = "IDEMPOTENCY_HIT";
        err.row = again;
        throw err;
      }

      db.prepare(
        `UPDATE game_sessions
         SET revision = ?, canonical_actions_json = ?
         WHERE id = ? AND status = 'active' AND revision = ?`
      ).run(revisionAfter, JSON.stringify(nextActions), gameId, expectedRevision);

      const stateRow = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      const responseData = buildStateDto(stateRow);

      db.prepare(
        `INSERT INTO game_commands (
          id, game_id, command_key, payload_hash, type,
          revision_before, revision_after, event_json, response_json
        ) VALUES (?, ?, ?, ?, 'advance', ?, ?, ?, ?)`
      ).run(
        commandId,
        gameId,
        commandKey,
        payloadHash,
        revisionBefore,
        revisionAfter,
        eventJson,
        JSON.stringify(responseData)
      );

      return responseData;
    });
    const data = tx();
    return { status: 200, data };
  } catch (e) {
    if (e.code === "IDEMPOTENCY_HIT" && e.row?.response_json) {
      try {
        return { status: 200, data: JSON.parse(e.row.response_json) };
      } catch {
        /* ignore */
      }
    }
    if (e.code === "REVISION_CONFLICT") {
      return {
        error: {
          status: 409,
          code: "REVISION_CONFLICT",
          message: "revision 不匹配，请重新拉取状态",
          details: { expected: expectedRevision, actual: e.actual },
        },
      };
    }
    if (e.code === "GAME_NOT_ACTIVE") {
      return {
        error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局不在进行中" },
      };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const again = db
        .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND command_key = ?`)
        .get(gameId, commandKey);
      if (again && again.payload_hash === payloadHash && again.response_json) {
        return { status: 200, data: JSON.parse(again.response_json) };
      }
      return {
        error: { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "幂等冲突" },
      };
    }
    throw e;
  }
}

/**
 * Normalize optional client action list for conflict check only.
 * Returns string[] or null if absent.
 */
function optionalClientActions(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length !== DECISION_DAYS) {
    return { error: true };
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const action = typeof item === "string" ? item : item?.action;
    if (!DECISION_ACTION_SET.has(action)) return { error: true };
    out.push(action);
  }
  return out;
}

function actionsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * event-v1 finish: settle from server canonical_actions_json only.
 * Body: { expectedRevision, finish: true }; client actions ignored unless they match.
 */
export function finishEventV1(userId, gameId, body, commandKey) {
  if (body?.finish !== true) {
    return {
      error: { status: 400, code: "FINISH_REQUIRED", message: "finish 必须为 true" },
    };
  }
  const expectedRevision = body?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return {
      error: {
        status: 400,
        code: "INVALID_REVISION",
        message: "event-v1 finish 需要 expectedRevision",
      },
    };
  }
  if (!commandKey || typeof commandKey !== "string" || commandKey.length < 8 || commandKey.length > 128) {
    return {
      error: {
        status: 400,
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key 必填（8-128）",
      },
    };
  }

  const clientActions = optionalClientActions(body?.actions);
  if (clientActions && clientActions.error) {
    return {
      error: {
        status: 400,
        code: "INVALID_ACTIONS",
        message: `若提交 actions 必须恰好 ${DECISION_DAYS} 个合法动作`,
      },
    };
  }

  const payloadHash = hashPayload({ expectedRevision, finish: true });
  const db = openDb();
  const now = nowIso();

  const existingCmd = db
    .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND command_key = ?`)
    .get(gameId, commandKey);
  if (existingCmd) {
    if (existingCmd.payload_hash !== payloadHash) {
      return {
        error: {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "同一幂等键不能用于不同结算负载",
        },
      };
    }
    if (existingCmd.response_json) {
      try {
        return { status: 200, data: JSON.parse(existingCmd.response_json) };
      } catch {
        /* fall through */
      }
    }
  }

  let row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
  if (!row || row.user_id !== userId) {
    return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
  }

  if (row.status === "settled") {
    const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
    if (!existing) {
      return { error: { status: 500, code: "INTERNAL", message: "结算记录缺失" } };
    }
    return { status: 200, data: resultDto(existing, row) };
  }

  row = expireIfNeeded(db, row);
  if (row.status === "expired") {
    return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期，无法结算" } };
  }
  if (row.status !== "active") {
    return {
      error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局已结束，无法结算" },
    };
  }
  if (row.protocol_version !== PROTOCOL_EVENT_V1) {
    return {
      error: {
        status: 409,
        code: "PROTOCOL_UNSUPPORTED",
        message: "非 event-v1 局请走批量 finish",
      },
    };
  }
  if (row.revision !== expectedRevision) {
    return {
      error: {
        status: 409,
        code: "REVISION_CONFLICT",
        message: "revision 不匹配，请重新拉取状态",
        details: { expected: expectedRevision, actual: row.revision },
      },
    };
  }

  const actions = parseActionsJson(row.canonical_actions_json);
  if (actions.length !== DECISION_DAYS) {
    return {
      error: {
        status: 409,
        code: "NOT_READY_TO_SETTLE",
        message: `需要恰好 ${DECISION_DAYS} 条规范动作后再结算`,
        details: { actionCount: actions.length },
      },
    };
  }
  if (clientActions && !actionsEqual(clientActions, actions)) {
    return {
      error: {
        status: 409,
        code: "SUBMISSION_CONFLICT",
        message: "客户端动作与服务端规范动作不一致，已拒绝覆盖",
      },
    };
  }

  const snapshot = JSON.parse(row.snapshot_json);
  const bars = snapshot.bars;
  const replay = settleGame({ fillMode: row.fill_mode, bars, actions });
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

  const metrics = settleCurveMetrics({
    fillMode: row.fill_mode,
    bars,
    actions,
  });
  const submissionHash = hashPayload({ actions, finish: true, protocol: PROTOCOL_EVENT_V1 });
  const equityStr = String(replay.equityMultiple);
  const revisionBefore = row.revision;
  const revisionAfter = revisionBefore + 1;
  const commandId = crypto.randomUUID();
  const assistClass = row.assist_class || ASSIST_CLEAN;

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
        const err = new Error("IDEMPOTENT_HIT");
        err.code = "IDEMPOTENT_HIT";
        err.existing = existing;
        err.session = fresh;
        throw err;
      }
      if (fresh.status !== "active" || fresh.revision !== expectedRevision) {
        const err = new Error("REVISION_CONFLICT");
        err.code = "REVISION_CONFLICT";
        err.actual = fresh.revision;
        throw err;
      }
      if (Date.parse(fresh.expires_at) <= Date.now()) {
        db.prepare(`UPDATE game_sessions SET status = 'expired' WHERE id = ?`).run(gameId);
        const err = new Error("GAME_EXPIRED");
        err.code = "GAME_EXPIRED";
        throw err;
      }

      const again = db
        .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND command_key = ?`)
        .get(gameId, commandKey);
      if (again?.response_json) {
        const err = new Error("IDEMPOTENCY_HIT");
        err.code = "IDEMPOTENCY_HIT";
        err.row = again;
        throw err;
      }

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
        equityStr,
        replay.tradeCount,
        replay.valuation ? JSON.stringify(replay.valuation) : null,
        metrics.mddPpm,
        metrics.benchmarkReturnPpm,
        JSON.stringify(metrics.equityCurve),
        metrics.scoreVersion || SCORE_VERSION_CURVE_V1,
        assistClass
      );

      db.prepare(
        `UPDATE game_sessions
         SET status = 'settled', finished_at = ?, revision = ?
         WHERE id = ? AND status = 'active' AND revision = ?`
      ).run(now, revisionAfter, gameId, expectedRevision);

      const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      const result = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
      const responseData = resultDto(result, sess);

      db.prepare(
        `INSERT INTO game_commands (
          id, game_id, command_key, payload_hash, type,
          revision_before, revision_after, event_json, response_json
        ) VALUES (?, ?, ?, ?, 'finish', ?, ?, ?, ?)`
      ).run(
        commandId,
        gameId,
        commandKey,
        payloadHash,
        revisionBefore,
        revisionAfter,
        JSON.stringify({ type: "finish", scoreVersion: metrics.scoreVersion }),
        JSON.stringify(responseData)
      );

      return { sess, responseData };
    });
    const { sess, responseData } = tx();
    if (sess?.fill_mode) invalidateLeaderboardCache(sess.fill_mode);
    else invalidateLeaderboardCache();
    return { status: 201, data: responseData };
  } catch (e) {
    if (e.code === "IDEMPOTENCY_HIT" && e.row?.response_json) {
      return { status: 200, data: JSON.parse(e.row.response_json) };
    }
    if (e.code === "IDEMPOTENT_HIT") {
      return { status: 200, data: resultDto(e.existing, e.session) };
    }
    if (e.code === "REVISION_CONFLICT") {
      return {
        error: {
          status: 409,
          code: "REVISION_CONFLICT",
          message: "revision 不匹配，请重新拉取状态",
          details: { expected: expectedRevision, actual: e.actual },
        },
      };
    }
    if (e.code === "GAME_EXPIRED") {
      return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期，无法结算" } };
    }
    if (e.code === "NOT_FOUND") {
      return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
    }
    if (String(e.message || "").includes("UNIQUE")) {
      const existing = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
      const sess = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (existing) {
        return { status: 200, data: resultDto(existing, sess) };
      }
    }
    throw e;
  }
}

/** Column values when issuing a new event-v1 classic session (flag ON). */
export function eventV1CreateColumns() {
  return {
    protocol_version: PROTOCOL_EVENT_V1,
    revision: 0,
    undo_count: 0,
    assist_class: ASSIST_CLEAN,
    canonical_actions_json: "[]",
    game_kind: GAME_KIND_CLASSIC,
  };
}
