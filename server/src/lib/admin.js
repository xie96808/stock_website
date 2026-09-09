import { openDb } from "../db/connection.js";
import { readBackupStatus, getBackupAgeSeconds } from "./backup.js";
import { config } from "./config.js";
import { findUserById, publicUser } from "./users.js";
import { revokeAllUserSessions } from "./sessions.js";
import { writeAuditLog } from "./audit.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";

function requireReason(reason) {
  if (typeof reason !== "string") return "必须填写原因";
  const t = reason.trim();
  if (t.length < 2) return "原因至少 2 个字";
  if (t.length > 500) return "原因过长";
  return null;
}

export function searchUsers({ q = "", status = "", limit = 20, cursor = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const clauses = ["status != 'deleted'"];
  const params = [];
  const query = typeof q === "string" ? q.trim() : "";
  if (query) {
    if (/^\d+$/.test(query)) {
      clauses.push("(id = ? OR username_normalized LIKE ? OR nickname LIKE ?)");
      params.push(Number(query), `%${query.toLowerCase()}%`, `%${query}%`);
    } else {
      clauses.push("(username_normalized LIKE ? OR nickname LIKE ?)");
      params.push(`%${query.toLowerCase()}%`, `%${query}%`);
    }
  }
  if (status === "active" || status === "disabled") {
    clauses.push("status = ?");
    params.push(status);
  }
  if (cursor != null && cursor !== "") {
    const c = Number(cursor);
    if (Number.isFinite(c)) {
      clauses.push("id < ?");
      params.push(c);
    }
  }
  const rows = openDb()
    .prepare(
      `SELECT * FROM users
       WHERE ${clauses.join(" AND ")}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params, lim + 1);
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return {
    items: page.map(publicUser),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  };
}

export function getAdminUser(id) {
  const row = findUserById(id);
  if (!row || row.status === "deleted") return null;
  const stats = openDb()
    .prepare(
      `SELECT
         COUNT(*) AS settled_count,
         SUM(CASE WHEN r.validity = 'valid' THEN 1 ELSE 0 END) AS valid_count,
         SUM(CASE WHEN r.leaderboard_hidden = 1 THEN 1 ELSE 0 END) AS hidden_count
       FROM game_sessions s
       LEFT JOIN game_results r ON r.game_id = s.id
       WHERE s.user_id = ? AND s.status = 'settled'`
    )
    .get(id);
  return {
    user: publicUser(row),
    stats: {
      settledCount: Number(stats?.settled_count || 0),
      validCount: Number(stats?.valid_count || 0),
      hiddenCount: Number(stats?.hidden_count || 0),
    },
  };
}

/**
 * Ban (disable) or restore (active) a user. Revokes sessions on disable.
 */
export function setUserStatus({
  actorId,
  targetUserId,
  status,
  reason,
  requestId = null,
  expectedUpdatedAt = null,
}) {
  const reasonErr = requireReason(reason);
  if (reasonErr) return { error: { status: 400, code: "REASON_REQUIRED", message: reasonErr } };
  if (status !== "active" && status !== "disabled") {
    return { error: { status: 400, code: "INVALID_STATUS", message: "status 须为 active 或 disabled" } };
  }
  if (Number(actorId) === Number(targetUserId) && status === "disabled") {
    return { error: { status: 400, code: "CANNOT_DISABLE_SELF", message: "不能禁用自己的账号" } };
  }

  const db = openDb();
  const target = findUserById(targetUserId);
  if (!target || target.status === "deleted") {
    return { error: { status: 404, code: "NOT_FOUND", message: "用户不存在" } };
  }
  if (expectedUpdatedAt != null && target.updated_at !== expectedUpdatedAt) {
    return { error: { status: 409, code: "VERSION_CONFLICT", message: "用户已被他人修改，请刷新后重试" } };
  }
  if (target.role === "admin" && status === "disabled") {
    const adminCount = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`)
      .get().n;
    if (adminCount <= 1) {
      return {
        error: {
          status: 400,
          code: "LAST_ADMIN",
          message: "不能禁用最后一个管理员",
        },
      };
    }
  }
  if (target.status === status) {
    return { status: 200, data: { user: publicUser(target), unchanged: true } };
  }

  const before = { status: target.status };
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, targetUserId);
    if (status === "disabled") {
      revokeAllUserSessions(targetUserId);
    }
    writeAuditLog({
      actorId,
      action: status === "disabled" ? "user.disable" : "user.enable",
      targetType: "user",
      targetId: String(targetUserId),
      reason: reason.trim(),
      before,
      after: { status },
      requestId,
    });
  });
  tx();
  invalidateLeaderboardCache();
  return { status: 200, data: { user: publicUser(findUserById(targetUserId)) } };
}

export function getAdminGame(gameId) {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT s.*, r.return_ppm, r.trade_count, r.validity, r.leaderboard_hidden,
              r.moderation_reason, r.moderated_by, r.moderated_at, r.created_at AS result_created_at,
              u.username_normalized, u.nickname, u.status AS user_status, u.role AS user_role
       FROM game_sessions s
       LEFT JOIN game_results r ON r.game_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(gameId);
  if (!row) return null;
  return {
    gameId: row.id,
    userId: row.user_id,
    username: row.username_normalized,
    nickname: row.nickname,
    userStatus: row.user_status,
    userRole: row.user_role,
    fillMode: row.fill_mode,
    ruleVersion: row.rule_version,
    datasetVersion: row.dataset_version,
    status: row.status,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    finishedAt: row.finished_at,
    returnPpm: row.return_ppm ?? null,
    tradeCount: row.trade_count ?? null,
    validity: row.validity ?? null,
    leaderboardHidden: row.leaderboard_hidden != null ? !!row.leaderboard_hidden : null,
    moderationReason: row.moderation_reason ?? null,
    moderatedBy: row.moderated_by ?? null,
    moderatedAt: row.moderated_at ?? null,
  };
}

export function searchGames({ q = "", fillMode = "", limit = 20, cursor = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const clauses = ["s.status = 'settled'"];
  const params = [];
  const query = typeof q === "string" ? q.trim() : "";
  if (query) {
    if (query.includes("-") || query.length > 20) {
      clauses.push("s.id = ?");
      params.push(query);
    } else if (/^\d+$/.test(query)) {
      clauses.push("(s.user_id = ? OR u.username_normalized LIKE ? OR u.nickname LIKE ?)");
      params.push(Number(query), `%${query.toLowerCase()}%`, `%${query}%`);
    } else {
      clauses.push("(u.username_normalized LIKE ? OR u.nickname LIKE ? OR s.id LIKE ?)");
      params.push(`%${query.toLowerCase()}%`, `%${query}%`, `%${query}%`);
    }
  }
  if (fillMode === "next_open" || fillMode === "same_close") {
    clauses.push("s.fill_mode = ?");
    params.push(fillMode);
  }
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
      if (parsed?.finishedAt && parsed?.id) {
        clauses.push("(s.finished_at < ? OR (s.finished_at = ? AND s.id < ?))");
        params.push(parsed.finishedAt, parsed.finishedAt, parsed.id);
      }
    } catch {
      /* ignore bad cursor */
    }
  }
  const rows = openDb()
    .prepare(
      `SELECT s.id, s.user_id, s.fill_mode, s.finished_at, s.rule_version,
              r.return_ppm, r.trade_count, r.validity, r.leaderboard_hidden,
              r.moderation_reason, u.username_normalized, u.nickname
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY s.finished_at DESC, s.id DESC
       LIMIT ?`
    )
    .all(...params, lim + 1);
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const items = page.map((r) => ({
    gameId: r.id,
    userId: r.user_id,
    username: r.username_normalized,
    nickname: r.nickname,
    fillMode: r.fill_mode,
    finishedAt: r.finished_at,
    ruleVersion: r.rule_version,
    returnPpm: r.return_ppm,
    tradeCount: r.trade_count,
    validity: r.validity,
    leaderboardHidden: !!r.leaderboard_hidden,
    moderationReason: r.moderation_reason,
  }));
  let nextCursor = null;
  if (hasMore) {
    const last = page[page.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ finishedAt: last.finished_at, id: last.id }),
      "utf8"
    ).toString("base64url");
  }
  return { items, nextCursor };
}

/**
 * Moderate a settled game result.
 * @param {object} opts
 * @param {'unlist'|'relist'|'invalidate'|'restore'} opts.action
 */
export function moderateGame({
  actorId,
  gameId,
  action,
  reason,
  requestId = null,
  expectedModeratedAt = null,
}) {
  const reasonErr = requireReason(reason);
  if (reasonErr) return { error: { status: 400, code: "REASON_REQUIRED", message: reasonErr } };

  const allowed = new Set(["unlist", "relist", "invalidate", "restore"]);
  if (!allowed.has(action)) {
    return {
      error: {
        status: 400,
        code: "INVALID_ACTION",
        message: "action 须为 unlist / relist / invalidate / restore",
      },
    };
  }

  const db = openDb();
  const row = db
    .prepare(
      `SELECT s.id, s.status AS session_status, r.*
       FROM game_sessions s
       JOIN game_results r ON r.game_id = s.id
       WHERE s.id = ?`
    )
    .get(gameId);
  if (!row) {
    return { error: { status: 404, code: "NOT_FOUND", message: "战绩不存在" } };
  }
  if (row.session_status !== "settled") {
    return { error: { status: 409, code: "NOT_SETTLED", message: "仅已结算战绩可治理" } };
  }
  if (expectedModeratedAt !== undefined && expectedModeratedAt !== null) {
    const current = row.moderated_at || null;
    if (current !== expectedModeratedAt) {
      return { error: { status: 409, code: "VERSION_CONFLICT", message: "战绩已被他人修改，请刷新后重试" } };
    }
  }

  let validity = row.validity;
  let hidden = row.leaderboard_hidden;
  if (action === "unlist") {
    hidden = 1;
  } else if (action === "relist") {
    hidden = 0;
  } else if (action === "invalidate") {
    validity = "invalid";
  } else if (action === "restore") {
    validity = "valid";
  }

  const before = {
    validity: row.validity,
    leaderboard_hidden: row.leaderboard_hidden,
    moderation_reason: row.moderation_reason,
  };
  const after = {
    validity,
    leaderboard_hidden: hidden,
    moderation_reason: reason.trim(),
  };

  const auditAction =
    action === "unlist"
      ? "game.unlist"
      : action === "relist"
        ? "game.relist"
        : action === "invalidate"
          ? "game.invalidate"
          : "game.restore";

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE game_results SET
         validity = ?,
         leaderboard_hidden = ?,
         moderation_reason = ?,
         moderated_by = ?,
         moderated_at = datetime('now')
       WHERE game_id = ?`
    ).run(validity, hidden, reason.trim(), actorId, gameId);
    writeAuditLog({
      actorId,
      action: auditAction,
      targetType: "game",
      targetId: String(gameId),
      reason: reason.trim(),
      before,
      after,
      requestId,
    });
  });
  tx();
  invalidateLeaderboardCache();

  return { status: 200, data: { game: getAdminGame(gameId) } };
}

export function getAdminOverview() {
  const db = openDb();
  const users = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS registered_7d
     FROM users WHERE status != 'deleted'`
  ).get();
  const games = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) AS settled,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
     FROM game_sessions`
  ).get();
  let schemaVersion = null;
  try {
    const row = db.prepare(
      `SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1`
    ).get();
    schemaVersion = row?.id || null;
  } catch { /* ignore */ }
  const backupStatus = readBackupStatus();
  return {
    users: {
      total: Number(users?.total || 0),
      registered7d: Number(users?.registered_7d || 0),
    },
    games: {
      settled: Number(games?.settled || 0),
      active: Number(games?.active || 0),
    },
    system: {
      schemaVersion,
      adminEnabled: !!config.adminEnabled,
      registrationEnabled: !!config.registrationEnabled,
      cloudGamesEnabled: !!config.cloudGamesEnabled,
      leaderboardEnabled: !!config.leaderboardEnabled,
    },
    backup: {
      lastSuccessAt: backupStatus?.lastSuccessAt || null,
      ageSeconds: getBackupAgeSeconds(),
      sizeBytes: backupStatus?.sizeBytes ?? null,
      integrityOk: backupStatus?.integrityOk ?? null,
      sha256: backupStatus?.sha256 || null,
    },
  };
}

