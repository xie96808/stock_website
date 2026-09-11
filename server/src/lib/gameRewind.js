/**
 * F03: once-per-game rewind for new-protocol classic sessions.
 * Atomic: validate → restore actions → command audit → deductRewardClaim → assist mark.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { sha256Text } from "./dataset.js";
import { replayGame, DECISION_DAYS } from "../../../shared/engine.js";
import {
  PROTOCOL_EVENT_V1,
  ASSIST_UNDO,
  GAME_KIND_CLASSIC,
} from "../../../shared/protocol.js";
import { deductRewardClaim } from "./rewardClaims.js";
import { JIU_COIN_GAME_REWIND_COST, getJiuCoinBalance } from "./jiuCoin.js";
import { buildStateDto } from "./gameProtocol.js";

export const REWIND_COST = JIU_COIN_GAME_REWIND_COST;
export const REWIND_REASON = "game_rewind";

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

function rewardKeyForGame(gameId) {
  return `game:${gameId}:rewind`;
}

function rewindResponse({ state, balanceBefore, balanceAfter, revokedAction, restoredDecisionDay, unchanged }) {
  return {
    ...state,
    balanceBefore,
    balanceAfter,
    balance: balanceAfter,
    revokedAction,
    restoredDecisionDay,
    rewindCost: REWIND_COST,
    unchanged: !!unchanged,
  };
}

/**
 * POST /games/:id/rewind
 * Body: { expectedRevision }
 * Header: Idempotency-Key
 */
export function rewindGame(userId, gameId, body, commandKey) {
  if (!config.gameRewindEnabled) {
    return {
      error: {
        status: 403,
        code: "GAME_REWIND_DISABLED",
        message: "反悔功能未启用",
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
  const expectedRevision = body?.expectedRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return {
      error: {
        status: 400,
        code: "INVALID_REVISION",
        message: "expectedRevision 必须是非负整数",
      },
    };
  }

  const payloadHash = hashPayload({ expectedRevision, rewind: true });
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
          message: "同一幂等键不能用于不同反悔负载",
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
  row = expireIfNeeded(db, row);

  if (row.status === "expired") {
    return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期" } };
  }
  if (row.status !== "active") {
    return {
      error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局不在进行中，无法反悔" },
    };
  }
  if (row.protocol_version !== PROTOCOL_EVENT_V1) {
    return {
      error: {
        status: 409,
        code: "PROTOCOL_UNSUPPORTED",
        message: "仅新协议经典局支持反悔",
        details: { protocolVersion: row.protocol_version },
      },
    };
  }
  if ((row.game_kind || GAME_KIND_CLASSIC) !== GAME_KIND_CLASSIC) {
    return {
      error: {
        status: 409,
        code: "GAME_KIND_UNSUPPORTED",
        message: "仅经典随机局支持反悔",
        details: { gameKind: row.game_kind },
      },
    };
  }
  if ((row.undo_count ?? 0) >= 1) {
    return {
      error: {
        status: 409,
        code: "REWIND_ALREADY_USED",
        message: "本局已使用过反悔",
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
  if (prevActions.length < 1) {
    return {
      error: {
        status: 409,
        code: "NO_DECISION_TO_REWIND",
        message: "至少需要一条已提交决策才能反悔",
      },
    };
  }

  const revokedAction = prevActions[prevActions.length - 1];
  const nextActions = prevActions.slice(0, -1);
  const restoredDecisionDay = nextActions.length + 1;

  // Validate remaining sequence restores a legal book (T+1 etc.).
  const snapshot = JSON.parse(row.snapshot_json);
  if (nextActions.length > 0) {
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
          message: replay.message || "回放失败，无法反悔",
          details: { day: replay.day, position: replay.position },
        },
      };
    }
  }

  const balanceBefore = getJiuCoinBalance(userId, db);
  if (balanceBefore < REWIND_COST) {
    return {
      error: {
        status: 402,
        code: "INSUFFICIENT_FUNDS",
        message: "韭币不足",
        details: { balance: balanceBefore, required: REWIND_COST },
      },
    };
  }

  const revisionBefore = row.revision;
  const revisionAfter = revisionBefore + 1;
  const commandId = crypto.randomUUID();
  const eventJson = JSON.stringify({
    type: "rewind",
    revokedAction,
    restoredDecisionDay,
    actionCountBefore: prevActions.length,
    actionCountAfter: nextActions.length,
  });

  try {
    const tx = db.transaction(() => {
      const fresh = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      if (!fresh || fresh.user_id !== userId) {
        const err = new Error("NOT_FOUND");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (fresh.status !== "active") {
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
      if ((fresh.undo_count ?? 0) >= 1) {
        const err = new Error("REWIND_ALREADY_USED");
        err.code = "REWIND_ALREADY_USED";
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

      const balBeforeTx = getJiuCoinBalance(userId, db);

      // Deduct first so insufficient funds aborts with no game mutation.
      let deduct;
      try {
        deduct = deductRewardClaim(db, {
          userId,
          rewardKey: rewardKeyForGame(gameId),
          amount: REWIND_COST,
          reason: REWIND_REASON,
          refType: "game",
          refId: gameId,
          meta: {
            revokedAction,
            restoredDecisionDay,
            revisionBefore,
            revisionAfter,
          },
        });
      } catch (e) {
        if (e.code === "INSUFFICIENT_FUNDS") {
          const err = new Error("INSUFFICIENT_FUNDS");
          err.code = "INSUFFICIENT_FUNDS";
          err.balance = e.balance;
          err.required = e.required;
          throw err;
        }
        throw e;
      }

      // Idempotent deduct hit without a matching command should not mutate game again.
      // (Normal path: first rewind → unchanged:false. Retry same key hits command table first.)
      if (deduct.unchanged) {
        const stateRow = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
        const responseData = rewindResponse({
          state: buildStateDto(stateRow),
          balanceBefore: deduct.balance + REWIND_COST,
          balanceAfter: deduct.balance,
          revokedAction,
          restoredDecisionDay,
          unchanged: true,
        });
        return responseData;
      }

      const upd = db
        .prepare(
          `UPDATE game_sessions
           SET revision = ?,
               canonical_actions_json = ?,
               undo_count = 1,
               assist_class = ?
           WHERE id = ? AND status = 'active' AND revision = ? AND undo_count = 0`
        )
        .run(
          revisionAfter,
          JSON.stringify(nextActions),
          ASSIST_UNDO,
          gameId,
          expectedRevision
        );
      if (upd.changes !== 1) {
        const err = new Error("REVISION_CONFLICT");
        err.code = "REVISION_CONFLICT";
        err.actual = db.prepare(`SELECT revision FROM game_sessions WHERE id = ?`).get(gameId)?.revision;
        throw err;
      }

      const stateRow = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(gameId);
      const responseData = rewindResponse({
        state: buildStateDto(stateRow),
        balanceBefore: balBeforeTx,
        balanceAfter: deduct.balance,
        revokedAction,
        restoredDecisionDay,
        unchanged: false,
      });

      db.prepare(
        `INSERT INTO game_commands (
          id, game_id, command_key, payload_hash, type,
          revision_before, revision_after, event_json, response_json
        ) VALUES (?, ?, ?, ?, 'rewind', ?, ?, ?, ?)`
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
        error: { status: 409, code: "GAME_NOT_ACTIVE", message: "对局不在进行中，无法反悔" },
      };
    }
    if (e.code === "REWIND_ALREADY_USED") {
      return {
        error: { status: 409, code: "REWIND_ALREADY_USED", message: "本局已使用过反悔" },
      };
    }
    if (e.code === "GAME_EXPIRED") {
      return { error: { status: 410, code: "GAME_EXPIRED", message: "对局已过期" } };
    }
    if (e.code === "NOT_FOUND") {
      return { error: { status: 404, code: "NOT_FOUND", message: "对局不存在" } };
    }
    if (e.code === "INSUFFICIENT_FUNDS") {
      return {
        error: {
          status: 402,
          code: "INSUFFICIENT_FUNDS",
          message: "韭币不足",
          details: { balance: e.balance, required: e.required || REWIND_COST },
        },
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

/** Eligibility hint for state DTO / clients (does not check balance). */
export function canRewindSession(row, { flagEnabled = config.gameRewindEnabled } = {}) {
  if (!flagEnabled) return false;
  if (!row || row.status !== "active") return false;
  if (row.protocol_version !== PROTOCOL_EVENT_V1) return false;
  if ((row.game_kind || GAME_KIND_CLASSIC) !== GAME_KIND_CLASSIC) return false;
  if ((row.undo_count ?? 0) >= 1) return false;
  const actions = parseActionsJson(row.canonical_actions_json);
  if (actions.length < 1) return false;
  if (actions.length > DECISION_DAYS) return false;
  return true;
}
