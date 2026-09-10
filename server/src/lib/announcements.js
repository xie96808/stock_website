import { openDb } from "../db/connection.js";
import { writeAuditLog } from "./audit.js";

const STATUSES = new Set(["draft", "published", "archived"]);
const MAX_TITLE = 80;
const MAX_BODY = 4000;

function trimOrNull(v) {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : null;
}

function parseTitle(title) {
  if (title === undefined) return { ok: true, skip: true };
  const t = trimOrNull(title);
  if (t === undefined) {
    return { error: { status: 400, code: "INVALID_TITLE", message: "标题须为字符串" } };
  }
  if (t != null && [...t].length > MAX_TITLE) {
    return { error: { status: 400, code: "TITLE_TOO_LONG", message: `标题最多 ${MAX_TITLE} 字` } };
  }
  return { ok: true, value: t };
}

function parseBody(body, { required }) {
  if (body === undefined) {
    if (required) {
      return { error: { status: 400, code: "INVALID_BODY", message: "正文必填" } };
    }
    return { ok: true, skip: true };
  }
  if (typeof body !== "string" || !body.trim()) {
    return { error: { status: 400, code: "INVALID_BODY", message: "正文不能为空" } };
  }
  const b = body.trim();
  if ([...b].length > MAX_BODY) {
    return { error: { status: 400, code: "BODY_TOO_LONG", message: `正文最多 ${MAX_BODY} 字` } };
  }
  return { ok: true, value: b };
}

function parseStatus(status, { required = false } = {}) {
  if (status === undefined) {
    if (required) {
      return { error: { status: 400, code: "INVALID_STATUS", message: "status 须为 draft / published / archived" } };
    }
    return { ok: true, skip: true };
  }
  if (!STATUSES.has(status)) {
    return { error: { status: 400, code: "INVALID_STATUS", message: "status 须为 draft / published / archived" } };
  }
  return { ok: true, value: status };
}

function mapPublic(row) {
  return {
    id: row.id,
    title: row.title || null,
    body: row.body,
    publishedAt: row.published_at,
  };
}

function mapAdmin(row) {
  return {
    id: row.id,
    title: row.title || null,
    body: row.body,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/** Published notices, newest first (by published_at, then id). */
export function listPublishedAnnouncements({ limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = openDb()
    .prepare(
      `SELECT id, title, body, published_at
       FROM announcements
       WHERE status = 'published'
       ORDER BY datetime(published_at) DESC, id DESC
       LIMIT ?`
    )
    .all(lim);
  return { items: rows.map(mapPublic) };
}

export function listAdminAnnouncements({ status = "", limit = 50, cursor = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const clauses = [];
  const params = [];
  if (status && STATUSES.has(String(status))) {
    clauses.push("status = ?");
    params.push(String(status));
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
      `SELECT id, title, body, status, published_at, created_at, updated_at, created_by
       FROM announcements
       ${where}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params, lim + 1);
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return {
    items: page.map(mapAdmin),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
  };
}

export function getAdminAnnouncement(id) {
  const row = openDb()
    .prepare(
      `SELECT id, title, body, status, published_at, created_at, updated_at, created_by
       FROM announcements WHERE id = ?`
    )
    .get(id);
  return row ? mapAdmin(row) : null;
}

export function createAnnouncement({
  actorId,
  title = null,
  body,
  status = "draft",
  requestId = null,
}) {
  const titleP = parseTitle(title);
  if (titleP.error) return titleP;
  const bodyP = parseBody(body, { required: true });
  if (bodyP.error) return bodyP;
  const statusP = parseStatus(status ?? "draft", { required: true });
  if (statusP.error) return statusP;

  const titleVal = titleP.skip ? null : titleP.value;
  const bodyVal = bodyP.value;
  const st = statusP.value;

  const db = openDb();
  const info = db
    .prepare(
      `INSERT INTO announcements (title, body, status, published_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END, ?, datetime('now'), datetime('now'))`
    )
    .run(titleVal, bodyVal, st, st, actorId ?? null);
  const id = Number(info.lastInsertRowid);
  writeAuditLog({
    actorId,
    action: "announcement.create",
    targetType: "announcement",
    targetId: String(id),
    reason: "create",
    before: null,
    after: { status: st, title: titleVal, body: bodyVal },
    requestId,
  });
  return { status: 201, data: { announcement: getAdminAnnouncement(id) } };
}

export function updateAnnouncement({
  actorId,
  id,
  title,
  body,
  status,
  requestId = null,
  expectedUpdatedAt = null,
}) {
  if (!Number.isInteger(id)) {
    return { error: { status: 400, code: "INVALID_ID", message: "公告 ID 无效" } };
  }

  const titleP = parseTitle(title);
  if (titleP.error) return titleP;
  const bodyP = parseBody(body, { required: false });
  if (bodyP.error) return bodyP;
  const statusP = parseStatus(status);
  if (statusP.error) return statusP;

  if (titleP.skip && bodyP.skip && statusP.skip) {
    return { error: { status: 400, code: "NO_FIELDS", message: "没有可更新字段" } };
  }

  const db = openDb();
  const row = db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(id);
  if (!row) {
    return { error: { status: 404, code: "NOT_FOUND", message: "公告不存在" } };
  }
  if (expectedUpdatedAt != null && row.updated_at !== expectedUpdatedAt) {
    return { error: { status: 409, code: "VERSION_CONFLICT", message: "公告已被他人修改，请刷新后重试" } };
  }

  const nextTitle = titleP.skip ? row.title : titleP.value;
  const nextBody = bodyP.skip ? row.body : bodyP.value;
  const nextStatus = statusP.skip ? row.status : statusP.value;
  const becomePublished = nextStatus === "published" && row.status !== "published";
  const fillPublished = nextStatus === "published" && !row.published_at;

  const before = {
    status: row.status,
    title: row.title,
    body: row.body,
  };
  const after = {
    status: nextStatus,
    title: nextTitle,
    body: nextBody,
  };

  if (becomePublished || fillPublished) {
    db.prepare(
      `UPDATE announcements SET
         title = ?, body = ?, status = ?,
         published_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(nextTitle, nextBody, nextStatus, id);
  } else {
    db.prepare(
      `UPDATE announcements SET
         title = ?, body = ?, status = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(nextTitle, nextBody, nextStatus, id);
  }

  writeAuditLog({
    actorId,
    action: nextStatus === "archived" && row.status !== "archived"
      ? "announcement.archive"
      : "announcement.update",
    targetType: "announcement",
    targetId: String(id),
    reason: "update",
    before,
    after,
    requestId,
  });

  return { status: 200, data: { announcement: getAdminAnnouncement(id) } };
}

export function archiveAnnouncement({
  actorId,
  id,
  requestId = null,
  expectedUpdatedAt = null,
}) {
  return updateAnnouncement({
    actorId,
    id,
    status: "archived",
    requestId,
    expectedUpdatedAt,
  });
}
