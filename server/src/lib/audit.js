import { openDb } from "../db/connection.js";

const BEFORE_AFTER_ALLOW = new Set([
  "status",
  "role",
  "validity",
  "leaderboard_hidden",
  "leaderboardHidden",
  "moderation_reason",
  "moderated_by",
  "moderated_at",
  "nickname",
  "username_normalized",
  "username",
]);

function pickAllowed(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BEFORE_AFTER_ALLOW.has(k)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function writeAuditLog({
  actorId = null,
  action,
  targetType,
  targetId,
  reason = null,
  before = null,
  after = null,
  requestId = null,
}) {
  if (!action || !targetType || targetId == null) {
    throw new Error("audit requires action, targetType, targetId");
  }
  const beforeJson = pickAllowed(before);
  const afterJson = pickAllowed(after);
  const info = openDb()
    .prepare(
      `INSERT INTO audit_logs (
        actor_id, action, target_type, target_id, reason,
        before_json, after_json, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      actorId,
      String(action),
      String(targetType),
      String(targetId),
      reason != null ? String(reason) : null,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
      requestId != null ? String(requestId) : null
    );
  return info.lastInsertRowid;
}

export function listAuditLogs({
  actorId,
  targetType,
  targetId,
  action,
  limit = 20,
  cursor = null,
} = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const clauses = [];
  const params = [];
  if (actorId != null) {
    clauses.push("actor_id = ?");
    params.push(actorId);
  }
  if (targetType) {
    clauses.push("target_type = ?");
    params.push(String(targetType));
  }
  if (targetId != null) {
    clauses.push("target_id = ?");
    params.push(String(targetId));
  }
  if (action) {
    clauses.push("action = ?");
    params.push(String(action));
  }
  if (cursor != null && cursor !== "") {
    const c = Number(cursor);
    if (Number.isFinite(c)) {
      clauses.push("id < ?");
      params.push(c);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = openDb()
    .prepare(
      `SELECT id, actor_id, action, target_type, target_id, reason,
              before_json, after_json, request_id, created_at
       FROM audit_logs
       ${where}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params, lim + 1);

  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const items = page.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
    requestId: r.request_id,
    createdAt: r.created_at,
  }));
  const nextCursor = hasMore ? String(page[page.length - 1].id) : null;
  return { items, nextCursor };
}
