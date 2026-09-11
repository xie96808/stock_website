/**
 * B0-PR1 event-v1 protocol surface: state read + thin decision advance.
 * Legacy batch finish stays in games.js unchanged.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { sha256Text } from "./dataset.js";
import { replayGame, DECISION_DAYS } from "../../../shared/engine.js";
import {
  PROTOCOL_EVENT_V1,
  PROTOCOL_LEGACY_BATCH,
  DECISION_ACTION_SET,
  ASSIST_CLEAN,
  GAME_KIND_CLASSIC,
} from "../../../shared/protocol.js";

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

/**
 * Minimal visible state for owners (revision + canonical actions + session meta).
 */
export function buildStateDto(row) {
  const actions = parseActionsJson(row.canonical_actions_json);
  const decisionDay = Math.min(actions.length + 1, DECISION_DAYS);
  const readyToSettle = actions.length >= DECISION_DAYS && row.status === "active";
  return {
    gameId: row.id,
    protocolVersion: row.protocol_version || PROTOCOL_LEGACY_BATCH,
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
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    finishedAt: row.finished_at || null,
  };
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
