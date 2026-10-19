/**
 * Track R1 — user inventory (后悔券 etc.). Design: lucky-wheel DESIGN.md Rev 4 §8.2.
 *
 * - qty lives in user_items (CHECK 0..999); every change writes a user_item_ledger row in the SAME transaction.
 * - grant: idempotent by (reason, ref_id) through the ledger's partial unique indexes.
 * - consume: conditional UPDATE ... WHERE qty >= n (changes === 1) — never negative, safe under concurrency.
 * Callers pass their own `db` and run these inside their transaction (wheel spin, rewind, admin op).
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { writeAuditLog } from "./audit.js";

export const ITEM_QTY_CAP = 999;
export const ITEM_TYPES = Object.freeze({
  rewind_ticket: Object.freeze({ label: "后悔券" }),
});
export const ITEM_REASONS = Object.freeze(["wheel_prize", "rewind_use", "admin_grant", "admin_revoke"]);
export const ADMIN_ITEM_MAX = 50;

export class ItemError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function isoUtc(ts) {
  const s = String(ts);
  return /Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
}

export function getItemQty(db, userId, itemType) {
  const r = db.prepare(`SELECT qty FROM user_items WHERE user_id = ? AND item_type = ?`).get(userId, itemType);
  return r ? r.qty : 0;
}

function findLedgerByRef(db, { reason, refId, itemType }) {
  if (refId == null) return null;
  if (reason === "wheel_prize") {
    return db
      .prepare(`SELECT * FROM user_item_ledger WHERE reason = 'wheel_prize' AND ref_id = ? AND item_type = ?`)
      .get(String(refId), itemType);
  }
  if (reason === "rewind_use") {
    return db.prepare(`SELECT * FROM user_item_ledger WHERE reason = 'rewind_use' AND ref_id = ?`).get(String(refId));
  }
  if (reason === "admin_grant" || reason === "admin_revoke") {
    return db
      .prepare(`SELECT * FROM user_item_ledger WHERE reason IN ('admin_grant','admin_revoke') AND ref_id = ?`)
      .get(String(refId));
  }
  return null;
}

function insertLedger(db, { userId, itemType, delta, qtyAfter, reason, refType, refId, meta, createdBy }) {
  const info = db
    .prepare(
      `INSERT INTO user_item_ledger (user_id, item_type, delta, qty_after, reason, ref_type, ref_id, meta_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      itemType,
      delta,
      qtyAfter,
      reason,
      refType ?? null,
      refId != null ? String(refId) : null,
      meta ? JSON.stringify(meta) : null,
      createdBy ?? null
    );
  return Number(info.lastInsertRowid);
}

/**
 * Add qty. Returns { ledgerId, qtyAfter, unchanged } or { overflow: true, qty } when it would exceed `cap`.
 * Idempotent: an existing ledger row with the same (reason, refId) is returned with unchanged:true.
 */
export function grantItem(db, { userId, itemType, qty, reason, refType = null, refId = null, meta = null, createdBy = null, cap = ITEM_QTY_CAP }) {
  if (!Object.hasOwn(ITEM_TYPES, itemType)) throw new ItemError("BAD_ITEM", "未知道具类型");
  if (!Number.isInteger(qty) || qty < 1 || qty > ITEM_QTY_CAP) throw new ItemError("BAD_QTY", "数量无效");
  if (!ITEM_REASONS.includes(reason)) throw new Error(`bad item reason ${reason}`);
  const prior = findLedgerByRef(db, { reason, refId, itemType });
  if (prior) return { ledgerId: prior.id, qtyAfter: getItemQty(db, userId, itemType), unchanged: true };
  const have = getItemQty(db, userId, itemType);
  const limit = Math.min(ITEM_QTY_CAP, Number.isInteger(cap) ? cap : ITEM_QTY_CAP);
  if (have + qty > limit) return { overflow: true, qty: have };
  db.prepare(
    `INSERT INTO user_items (user_id, item_type, qty, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, item_type) DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at`
  ).run(userId, itemType, qty);
  const qtyAfter = getItemQty(db, userId, itemType);
  const ledgerId = insertLedger(db, { userId, itemType, delta: qty, qtyAfter, reason, refType, refId, meta, createdBy });
  return { ledgerId, qtyAfter, unchanged: false };
}

/**
 * Remove qty atomically. Throws ItemError NO_ITEM when the user holds fewer than qty.
 * Idempotent on (reason, refId) like grantItem.
 */
export function consumeItem(db, { userId, itemType, qty = 1, reason, refType = null, refId = null, meta = null, createdBy = null }) {
  if (!Object.hasOwn(ITEM_TYPES, itemType)) throw new ItemError("BAD_ITEM", "未知道具类型");
  if (!Number.isInteger(qty) || qty < 1) throw new ItemError("BAD_QTY", "数量无效");
  if (!ITEM_REASONS.includes(reason)) throw new Error(`bad item reason ${reason}`);
  const prior = findLedgerByRef(db, { reason, refId, itemType });
  if (prior) return { ledgerId: prior.id, qtyAfter: getItemQty(db, userId, itemType), unchanged: true };
  const upd = db
    .prepare(
      `UPDATE user_items SET qty = qty - ?, updated_at = datetime('now')
       WHERE user_id = ? AND item_type = ? AND qty >= ?`
    )
    .run(qty, userId, itemType, qty);
  if (upd.changes !== 1) {
    throw new ItemError("NO_ITEM", "道具不足", { have: getItemQty(db, userId, itemType), required: qty });
  }
  const qtyAfter = getItemQty(db, userId, itemType);
  const ledgerId = insertLedger(db, { userId, itemType, delta: -qty, qtyAfter, reason, refType, refId, meta, createdBy });
  return { ledgerId, qtyAfter, unchanged: false };
}

export function getInventory(userId, db = openDb()) {
  const rows = db.prepare(`SELECT item_type, qty FROM user_items WHERE user_id = ?`).all(userId);
  const by = new Map(rows.map((r) => [r.item_type, r.qty]));
  return Object.entries(ITEM_TYPES).map(([type, v]) => ({ type, label: v.label, qty: by.get(type) || 0 }));
}

/** GET /me/items payload. `rewindTicketBoard` lets the client word the confirm sheet to match the admin switch. */
export function myItems(userId, db = openDb()) {
  const items = getInventory(userId, db);
  const t = items.find((i) => i.type === "rewind_ticket");
  return {
    items,
    rewindTickets: t ? t.qty : 0,
    rewindEnabled: !!config.gameRewindEnabled,
    rewindTicketBoard: config.rewindTicketBoard === "undo" ? "undo" : "clean",
  };
}

export function itemLedger(userId, { limit = 30, db = openDb() } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return db
    .prepare(`SELECT * FROM user_item_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, lim)
    .map((r) => ({
      id: r.id,
      itemType: r.item_type,
      delta: r.delta,
      qtyAfter: r.qty_after,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      meta: r.meta_json ? safeJson(r.meta_json) : null,
      createdBy: r.created_by,
      createdAt: isoUtc(r.created_at),
    }));
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Reconciliation: rows where SUM(ledger.delta) != qty (should always be empty). */
export function reconcileItems(db = openDb()) {
  return db
    .prepare(
      `SELECT u.user_id AS userId, u.item_type AS itemType, u.qty AS qty, COALESCE(l.s, 0) AS ledgerSum
       FROM user_items u
       LEFT JOIN (SELECT user_id, item_type, SUM(delta) AS s FROM user_item_ledger GROUP BY user_id, item_type) l
         ON l.user_id = u.user_id AND l.item_type = u.item_type
       WHERE u.qty != COALESCE(l.s, 0)
       UNION ALL
       SELECT l.user_id, l.item_type, 0, l.s FROM
         (SELECT user_id, item_type, SUM(delta) AS s FROM user_item_ledger GROUP BY user_id, item_type) l
       WHERE NOT EXISTS (SELECT 1 FROM user_items u WHERE u.user_id = l.user_id AND u.item_type = l.item_type) AND l.s != 0`
    )
    .all();
}

function cleanReason(reason) {
  const r = typeof reason === "string" ? reason.trim() : "";
  return r.length >= 2 && r.length <= 200 ? r : null;
}

/** Admin grant (+) / revoke (−). Not subject to wheel supply caps. Idempotent by opKey. */
export function adminAdjustItems({ actorId, userId, itemType = "rewind_ticket", delta, reason, opKey = null, requestId = null }) {
  const why = cleanReason(reason);
  if (!why) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "原因需 2–200 字" };
  if (!Number.isInteger(userId)) return { ok: false, status: 400, code: "BAD_USER", message: "用户 ID 无效" };
  if (!Object.hasOwn(ITEM_TYPES, itemType)) return { ok: false, status: 400, code: "BAD_ITEM", message: "未知道具类型" };
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > ADMIN_ITEM_MAX) {
    return { ok: false, status: 400, code: "BAD_DELTA", message: `数量须为 ±1–${ADMIN_ITEM_MAX} 的整数` };
  }
  const db = openDb();
  const u = db.prepare(`SELECT id, status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status === "deleted") return { ok: false, status: 404, code: "NOT_FOUND", message: "用户不存在" };
  if (Number(u.is_bot) === 1) return { ok: false, status: 400, code: "BOT_NOT_ALLOWED", message: "机器人账号不能持有道具" };
  const refId = opKey ? `admin:${String(opKey).slice(0, 100)}` : null;
  try {
    return db.transaction(() => {
      const before = getItemQty(db, userId, itemType);
      const r =
        delta > 0
          ? grantItem(db, { userId, itemType, qty: delta, reason: "admin_grant", refType: "admin", refId, meta: { reason: why }, createdBy: actorId })
          : consumeItem(db, { userId, itemType, qty: -delta, reason: "admin_revoke", refType: "admin", refId, meta: { reason: why }, createdBy: actorId });
      if (r.overflow) throw new ItemError("QTY_CAP", `持有数量不能超过 ${ITEM_QTY_CAP}`);
      if (!r.unchanged) {
        writeAuditLog({
          actorId,
          action: delta > 0 ? "items.grant" : "items.revoke",
          targetType: "user",
          targetId: String(userId),
          reason: why,
          before: { itemType, qty: before },
          after: { itemType, qty: r.qtyAfter, delta },
          requestId,
        });
      }
      return { ok: true, itemType, qty: r.qtyAfter, ledgerId: r.ledgerId, unchanged: !!r.unchanged };
    })();
  } catch (e) {
    if (e instanceof ItemError) {
      const status = e.code === "NO_ITEM" ? 409 : 400;
      const message = e.code === "NO_ITEM" ? "扣除后数量不能小于 0" : e.message;
      return { ok: false, status, code: e.code === "NO_ITEM" ? "WOULD_GO_NEGATIVE" : e.code, message };
    }
    throw e;
  }
}

export function adminUserItems(userId, db = openDb()) {
  const u = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
  if (!u) return null;
  return { items: getInventory(userId, db), ledger: itemLedger(userId, { limit: 50, db }) };
}
