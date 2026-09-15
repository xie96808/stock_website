import fs from "node:fs";
import { openDb } from "../db/connection.js";
import { writeAuditLog } from "./audit.js";
import {
  FEEDBACK_MAX_IMAGES,
  saveFeedbackImageBuffer,
  feedbackImageFilePath,
  isSafeFeedbackImageId,
} from "./feedbackImages.js";

const STATUSES = new Set(["new", "read", "archived"]);
const MAX_BODY = 4000;
const MIN_BODY = 1;

function parseBody(body) {
  if (typeof body !== "string" || !body.trim()) {
    return { error: { status: 400, code: "INVALID_BODY", message: "请填写反馈内容" } };
  }
  const b = body.trim();
  const len = [...b].length;
  if (len < MIN_BODY) {
    return { error: { status: 400, code: "INVALID_BODY", message: "请填写反馈内容" } };
  }
  if (len > MAX_BODY) {
    return { error: { status: 400, code: "BODY_TOO_LONG", message: `反馈最多 ${MAX_BODY} 字` } };
  }
  return { ok: true, value: b };
}

function mapImage(row) {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    byteSize: row.byte_size,
    sortOrder: row.sort_order,
    url: `/api/v1/admin/feedback-images/${encodeURIComponent(row.filename)}`,
  };
}

function mapAdmin(row, images = []) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username || null,
    nickname: row.nickname || null,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at || null,
    archivedAt: row.archived_at || null,
    imageCount: images.length,
    images,
  };
}

function unlinkSaved(filenames) {
  for (const name of filenames) {
    const p = feedbackImageFilePath(name);
    if (!p) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Persist feedback + optional images. Rolls back DB + deletes files on failure.
 * @param {{ userId: number, body: string, imageBuffers?: Buffer[], requestId?: string|null }} opts
 */
export function createFeedback({ userId, body, imageBuffers = [], requestId = null }) {
  const parsed = parseBody(body);
  if (parsed.error) return { error: parsed.error };

  if (!Array.isArray(imageBuffers)) {
    return { error: { status: 400, code: "INVALID_IMAGES", message: "图片格式无效" } };
  }
  if (imageBuffers.length > FEEDBACK_MAX_IMAGES) {
    return {
      error: {
        status: 400,
        code: "TOO_MANY_IMAGES",
        message: `最多附带 ${FEEDBACK_MAX_IMAGES} 张图片`,
      },
    };
  }

  const savedFiles = [];
  const imageRows = [];
  for (const buf of imageBuffers) {
    const saved = saveFeedbackImageBuffer(buf);
    if (saved.error) {
      unlinkSaved(savedFiles);
      return { error: saved.error };
    }
    savedFiles.push(saved.filename);
    imageRows.push(saved);
  }

  const db = openDb();
  let feedbackId;
  try {
    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO user_feedback (user_id, body, status)
           VALUES (?, ?, 'new')`
        )
        .run(userId, parsed.value);
      feedbackId = Number(info.lastInsertRowid);
      const insImg = db.prepare(
        `INSERT INTO user_feedback_images (feedback_id, filename, mime, byte_size, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      imageRows.forEach((img, i) => {
        insImg.run(feedbackId, img.filename, img.mime, img.byteSize, i);
      });
      writeAuditLog({
        actorId: userId,
        action: "feedback.create",
        targetType: "feedback",
        targetId: feedbackId,
        after: { body: parsed.value.slice(0, 80), status: "new" },
        requestId,
      });
    });
    tx();
  } catch (e) {
    unlinkSaved(savedFiles);
    throw e;
  }

  const row = db.prepare(`SELECT * FROM user_feedback WHERE id = ?`).get(feedbackId);
  const imageCount =
    db.prepare(`SELECT COUNT(*) AS c FROM user_feedback_images WHERE feedback_id = ?`).get(feedbackId)?.c || 0;

  return {
    status: 201,
    data: {
      feedback: {
        id: row.id,
        body: row.body,
        status: row.status,
        createdAt: row.created_at,
        imageCount: Number(imageCount) || 0,
      },
    },
  };
}

export function listAdminFeedback({ status, limit = 20, cursor = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const clauses = [];
  const params = [];
  if (status) {
    if (!STATUSES.has(status)) {
      return { error: { status: 400, code: "INVALID_STATUS", message: "status 须为 new / read / archived" } };
    }
    clauses.push("f.status = ?");
    params.push(status);
  }
  if (cursor != null && cursor !== "") {
    const c = Number(cursor);
    if (Number.isFinite(c)) {
      clauses.push("f.id < ?");
      params.push(c);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = openDb()
    .prepare(
      `SELECT f.*, u.username_normalized AS username, u.nickname,
              (SELECT COUNT(*) FROM user_feedback_images i WHERE i.feedback_id = f.id) AS image_count
       FROM user_feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ${where}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ?`
    )
    .all(...params, lim + 1);

  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const items = page.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username || null,
    nickname: r.nickname || null,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    readAt: r.read_at || null,
    archivedAt: r.archived_at || null,
    imageCount: Number(r.image_count) || 0,
  }));
  const nextCursor = hasMore ? String(page[page.length - 1].id) : null;
  return { items, nextCursor };
}

export function getAdminFeedback(id) {
  const row = openDb()
    .prepare(
      `SELECT f.*, u.username_normalized AS username, u.nickname
       FROM user_feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.id = ?`
    )
    .get(id);
  if (!row) return null;
  const images = openDb()
    .prepare(
      `SELECT * FROM user_feedback_images
       WHERE feedback_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(id)
    .map(mapImage);
  return mapAdmin(row, images);
}

export function updateFeedbackStatus({
  actorId,
  id,
  status,
  requestId = null,
}) {
  if (!STATUSES.has(status)) {
    return { error: { status: 400, code: "INVALID_STATUS", message: "status 须为 new / read / archived" } };
  }
  const db = openDb();
  const row = db.prepare(`SELECT * FROM user_feedback WHERE id = ?`).get(id);
  if (!row) {
    return { error: { status: 404, code: "NOT_FOUND", message: "反馈不存在" } };
  }
  if (row.status === status) {
    return { status: 200, data: { feedback: getAdminFeedback(id) } };
  }

  // SQLite datetime('now') for consistency with rest of codebase
  let readAtSql = "read_at";
  let archivedAtSql = "archived_at";
  if (status === "read") {
    readAtSql = "COALESCE(read_at, datetime('now'))";
  } else if (status === "archived") {
    readAtSql = "COALESCE(read_at, datetime('now'))";
    archivedAtSql = "datetime('now')";
  } else if (status === "new") {
    readAtSql = "NULL";
    archivedAtSql = "NULL";
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE user_feedback
       SET status = ?,
           read_at = ${readAtSql},
           archived_at = ${archivedAtSql},
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(status, id);
    writeAuditLog({
      actorId,
      action: `feedback.${status}`,
      targetType: "feedback",
      targetId: id,
      before: { status: row.status },
      after: { status },
      requestId,
    });
  })();

  return { status: 200, data: { feedback: getAdminFeedback(id) } };
}

export function resolveFeedbackImage(filename) {
  if (!isSafeFeedbackImageId(filename)) return null;
  const filePath = feedbackImageFilePath(filename);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const row = openDb()
    .prepare(`SELECT * FROM user_feedback_images WHERE filename = ?`)
    .get(filename);
  if (!row) return null;
  return { filePath, mime: row.mime, filename: row.filename };
}
