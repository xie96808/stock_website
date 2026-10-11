import { shanghaiYmd } from "../jiuCoin.js";
import { writeAuditLog } from "../audit.js";
import { sha256Hex } from "../crypto.js";
import { blockUser } from "./eligibility.js";
import { validCreateKey } from "./challenges.js";
import { readDrain, writeDrainRow } from "./drain.js";
import { finishMatchInTx } from "./settlement.js";
import { publicNickname } from "./names.js";
import { withImmediate } from "./tx.js";
import { noteMatchChanged } from "./realtime.js";

const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_REASONS = new Set(["cheat", "grief_forfeit", "nickname", "other"]);
const REPORT_DAILY_CAP = 10;

function deny(code, message, status) {
  return { ok: false, code, message, status };
}

function codePointLength(value) {
  return [...String(value)].length;
}

function requireReason(reason) {
  if (typeof reason !== "string") return "必须填写原因";
  const trimmed = reason.trim();
  if (trimmed.length < 2) return "原因至少 2 个字";
  if (trimmed.length > 500) return "原因过长";
  return null;
}

function readCommand(db, userId, scope, key) {
  return db.prepare(`SELECT * FROM pvp_commands WHERE user_id = ? AND scope = ? AND key = ?`).get(userId, scope, key);
}

function storeCommand(db, { userId, scope, key, hash, resourceId, ack, now }) {
  db.prepare(
    `INSERT INTO pvp_commands (
      user_id, scope, key, payload_hash, resource_id, ack_json, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, scope, key, hash, resourceId || null, JSON.stringify(ack), now, now + COMMAND_TTL_MS);
}

function beginCommand(db, { userId, scope, key, hash }) {
  if (!validCreateKey(key)) return deny("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 须为 16-128 位可见 ASCII", 400);
  const prior = readCommand(db, userId, scope, key);
  if (!prior) return null;
  if (prior.payload_hash !== hash) return deny("IDEMPOTENCY_CONFLICT", "这个幂等键已经用于另一个请求", 409);
  return JSON.parse(prior.ack_json);
}

export function blockPlayer(db, { blockerId, blockedId, commandKey, now }) {
  return withImmediate(db, () => {
    const hash = sha256Hex(JSON.stringify({ blockedId: Number(blockedId) }));
    const prior = beginCommand(db, { userId: blockerId, scope: "pvp-block", key: commandKey, hash });
    if (prior) return prior;
    if (Number(blockerId) === Number(blockedId)) return deny("SELF_BLOCK", "不能屏蔽自己", 422);
    const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(blockedId);
    if (!user) return deny("NOT_FOUND", "用户不存在", 404);
    const saved = blockUser(db, blockerId, blockedId, now);
    if (!saved.ok) return saved;
    const ack = { ok: true, userId: Number(blockedId) };
    storeCommand(db, {
      userId: blockerId, scope: "pvp-block", key: commandKey, hash, resourceId: String(blockedId), ack, now,
    });
    return ack;
  });
}

export function unblockPlayer(db, blockerId, blockedId) {
  db.prepare(
    `DELETE FROM pvp_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?`
  ).run(blockerId, blockedId);
  return { ok: true };
}

export function listBlocks(db, blockerId, { cursor = 0, limit = 20 } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const after = Number(cursor) || 0;
  const rows = db.prepare(
    `SELECT b.blocked_user_id, b.created_at, u.nickname, u.status
     FROM pvp_blocks b
     JOIN users u ON u.id = b.blocked_user_id
     WHERE b.blocker_user_id = ? AND b.blocked_user_id > ?
     ORDER BY b.blocked_user_id ASC
     LIMIT ?`
  ).all(blockerId, after, size + 1);
  const slice = rows.slice(0, size);
  const last = slice[slice.length - 1];
  return {
    entries: slice.map((row) => ({
      userId: row.blocked_user_id,
      nickname: publicNickname(row),
      createdAt: row.created_at,
    })),
    nextCursor: rows.length > size && last ? String(last.blocked_user_id) : null,
  };
}

function reportCountToday(db, userId, now) {
  const ymd = shanghaiYmd(new Date(now));
  const start = Date.parse(`${ymd}T00:00:00+08:00`);
  return Number(
    db.prepare(`SELECT COUNT(*) AS c FROM pvp_reports WHERE reporter_id = ? AND created_at >= ?`).get(userId, start).c
  ) || 0;
}

function reportView(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    reporterId: row.reporter_id,
    reportedId: row.reported_id,
    reason: row.reason,
    detail: row.detail || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * One report per player per match. It does not move coins or ratings.
 * reportedId is always the other seat, never a client-supplied user.
 */
export function fileReport(db, { matchId, reporterId, reason, detail = "", commandKey, now }) {
  return withImmediate(db, () => {
    const text = detail == null ? "" : String(detail);
    if (!REPORT_REASONS.has(reason)) return deny("BAD_PAYLOAD", "举报原因无效", 422);
    if (codePointLength(text) > 500) return deny("DETAIL_TOO_LONG", "补充说明最长 500 字", 422);
    const hash = sha256Hex(JSON.stringify({ matchId, reason, detail: text }));
    const prior = beginCommand(db, { userId: reporterId, scope: `pvp-report:${matchId}`, key: commandKey, hash });
    if (prior) return prior;
    const players = db.prepare(`SELECT user_id FROM pvp_match_players WHERE match_id = ?`).all(matchId);
    const me = players.find((player) => player.user_id === reporterId);
    if (!me) return deny("NOT_PARTICIPANT", "你不在这局对战里", 403);
    const opponent = players.find((player) => player.user_id !== reporterId);
    if (!opponent) return deny("BAD_MATCH", "对局人数异常", 500);
    const match = db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(matchId);
    if (!match) return deny("NOT_FOUND", "对局不存在", 404);
    if (match.status !== "settled" && match.status !== "aborted") {
      return deny("MATCH_OPEN", "对局还没结束", 409);
    }
    const existing = db.prepare(
      `SELECT * FROM pvp_reports WHERE match_id = ? AND reporter_id = ?`
    ).get(matchId, reporterId);
    if (existing) {
      if (existing.reason !== reason || (existing.detail || "") !== text) {
        return deny("REPORT_EXISTS", "这局已经举报过", 409);
      }
      const ack = { ok: true, report: reportView(existing), replay: true };
      storeCommand(db, {
        userId: reporterId, scope: `pvp-report:${matchId}`, key: commandKey, hash, resourceId: String(existing.id), ack, now,
      });
      return ack;
    }
    if (reportCountToday(db, reporterId, now) >= REPORT_DAILY_CAP) {
      return deny("RATE_LIMIT", "今日举报次数已用完", 429);
    }
    const info = db.prepare(
      `INSERT INTO pvp_reports (
        match_id, reporter_id, reported_id, reason, detail, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?)`
    ).run(matchId, reporterId, opponent.user_id, reason, text, now);
    const row = db.prepare(`SELECT * FROM pvp_reports WHERE id = ?`).get(info.lastInsertRowid);
    const ack = { ok: true, report: reportView(row), replay: false };
    storeCommand(db, {
      userId: reporterId, scope: `pvp-report:${matchId}`, key: commandKey, hash, resourceId: String(row.id), ack, now,
    });
    return ack;
  });
}

function activeCounts(db) {
  const waitingReady = Number(db.prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status = 'waiting_ready'`).get().c) || 0;
  const playing = Number(db.prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status = 'playing'`).get().c) || 0;
  const refundHeadcount = Number(db.prepare(
    `SELECT COUNT(*) AS c
     FROM pvp_match_players p
     JOIN pvp_matches m ON m.id = p.match_id
     WHERE m.status = 'playing'
       AND EXISTS (
         SELECT 1 FROM jiu_coin_ledger l
         WHERE l.user_id = p.user_id AND l.ref_type = 'pvp_match' AND l.ref_id = m.id AND l.reason = 'pvp_entry'
       )`
  ).get().c) || 0;
  return { waitingReady, playing, rooms: waitingReady + playing, refundHeadcount };
}

export function adminOverview(db) {
  const counts = activeCounts(db);
  const openReports = Number(db.prepare(`SELECT COUNT(*) AS c FROM pvp_reports WHERE status = 'open'`).get().c) || 0;
  return {
    draining: readDrain(db),
    activeRooms: counts.rooms,
    waitingReady: counts.waitingReady,
    playing: counts.playing,
    openReports,
  };
}

export function adminListMatches(db, { status = "", cursor = "", limit = 20 } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const clauses = [];
  const params = [];
  if (status === "waiting_ready" || status === "playing" || status === "settled" || status === "aborted") {
    clauses.push("m.status = ?");
    params.push(status);
  }
  if (cursor) {
    clauses.push("m.rowid < ?");
    params.push(Number(cursor));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT m.rowid AS rowid, m.id, m.status, m.terminal_reason, m.finished_at, m.created_at
     FROM pvp_matches m
     ${where}
     ORDER BY m.rowid DESC
     LIMIT ?`
  ).all(...params, size + 1);
  const slice = rows.slice(0, size);
  return {
    entries: slice.map((row) => ({
      matchId: row.id,
      status: row.status,
      terminalReason: row.terminal_reason,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
    })),
    nextCursor: rows.length > size ? String(slice[slice.length - 1].rowid) : null,
  };
}

export function adminMatchDetail(db, matchId) {
  const match = db.prepare(`SELECT * FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match) return null;
  const settlement = db.prepare(`SELECT * FROM pvp_settlements WHERE match_id = ?`).get(matchId);
  const players = db.prepare(
    `SELECT user_id, seat, outcome, return_ppm, mdd_ppm, coin_delta, actions_json
     FROM pvp_match_players WHERE match_id = ? ORDER BY seat ASC`
  ).all(matchId);
  const ledger = db.prepare(
    `SELECT user_id, delta, reason FROM jiu_coin_ledger
     WHERE ref_type = 'pvp_match' AND ref_id = ? ORDER BY id ASC`
  ).all(String(matchId));
  let stockCode = null;
  let stockName = null;
  try {
    const snapshot = JSON.parse(match.snapshot_json || "null");
    stockCode = snapshot?.stockCode || null;
    stockName = snapshot?.stockName || null;
  } catch {
    stockCode = null;
  }
  return {
    matchId: match.id,
    status: match.status,
    terminalType: settlement?.terminal_type || null,
    terminalReason: match.terminal_reason,
    winnerUserId: match.winner_user_id,
    resolvedRounds: match.resolved_rounds,
    stockCode,
    stockName,
    players: players.map((player) => ({
      userId: player.user_id,
      seat: player.seat,
      outcome: player.outcome,
      returnPpm: player.return_ppm,
      mddPpm: player.mdd_ppm,
      coinDelta: player.coin_delta,
      actions: JSON.parse(player.actions_json || "[]"),
    })),
    ledger: ledger.map((row) => ({ userId: row.user_id, delta: row.delta, reason: row.reason })),
  };
}

export function adminListReports(db, { status = "open", cursor = "", limit = 20 } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const clauses = [];
  const params = [];
  if (status === "open" || status === "resolved" || status === "dismissed") {
    clauses.push("status = ?");
    params.push(status);
  }
  if (cursor) {
    clauses.push("id < ?");
    params.push(Number(cursor));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM pvp_reports ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, size + 1);
  const slice = rows.slice(0, size);
  return {
    entries: slice.map(reportView),
    nextCursor: rows.length > size ? String(slice[slice.length - 1].id) : null,
  };
}

export function adminUpdateReport(db, { reportId, actorId, status, resolution = "", reason, commandKey, requestId, now }) {
  return withImmediate(db, () => {
    const reasonErr = requireReason(reason);
    if (reasonErr) return deny("REASON_REQUIRED", reasonErr, 400);
    if (status !== "resolved" && status !== "dismissed") return deny("BAD_PAYLOAD", "处理状态无效", 422);
    const note = resolution == null ? "" : String(resolution);
    if (codePointLength(note) > 500) return deny("DETAIL_TOO_LONG", "处理备注最长 500 字", 422);
    const hash = sha256Hex(JSON.stringify({ reportId, status, resolution: note, reason: reason.trim() }));
    const prior = beginCommand(db, { userId: actorId, scope: `admin-pvp-report:${reportId}`, key: commandKey, hash });
    if (prior) return prior;
    const row = db.prepare(`SELECT * FROM pvp_reports WHERE id = ?`).get(reportId);
    if (!row) return deny("NOT_FOUND", "举报不存在", 404);
    db.prepare(
      `UPDATE pvp_reports
       SET status = ?, resolution = ?, reviewer_id = ?, closed_at = ?
       WHERE id = ?`
    ).run(status, note, actorId, now, reportId);
    writeAuditLog({
      actorId,
      action: "pvp.report.update",
      targetType: "pvp_report",
      targetId: String(reportId),
      reason: reason.trim(),
      before: { status: row.status },
      after: { status },
      requestId,
    });
    const ack = { ok: true, report: reportView(db.prepare(`SELECT * FROM pvp_reports WHERE id = ?`).get(reportId)) };
    storeCommand(db, {
      userId: actorId, scope: `admin-pvp-report:${reportId}`, key: commandKey, hash, resourceId: String(reportId), ack, now,
    });
    return ack;
  });
}

export function adminSetDrain(db, { actorId, draining, reason, commandKey, requestId, now }) {
  return withImmediate(db, () => {
    const reasonErr = requireReason(reason);
    if (reasonErr) return deny("REASON_REQUIRED", reasonErr, 400);
    if (typeof draining !== "boolean") return deny("BAD_PAYLOAD", "需要明确是否停止接新局", 422);
    const hash = sha256Hex(JSON.stringify({ draining, reason: reason.trim() }));
    const prior = beginCommand(db, { userId: actorId, scope: "admin-pvp-drain", key: commandKey, hash });
    if (prior) return prior;
    const before = readDrain(db);
    writeDrainRow(db, { draining, actorId, reason: reason.trim(), now });
    writeAuditLog({
      actorId,
      action: draining ? "pvp.drain" : "pvp.undrain",
      targetType: "pvp_runtime",
      targetId: "drain",
      reason: reason.trim(),
      before: { drain: before },
      after: { drain: draining },
      requestId,
    });
    const ack = { ok: true, draining };
    storeCommand(db, {
      userId: actorId, scope: "admin-pvp-drain", key: commandKey, hash, resourceId: "drain", ack, now,
    });
    return ack;
  });
}

export function adminAbortPreview(db) {
  return { ok: true, confirmRequired: true, ...activeCounts(db) };
}

export function adminAbortActive(db, { actorId, reason, commandKey, requestId, now }) {
  return withImmediate(db, () => {
    const reasonErr = requireReason(reason);
    if (reasonErr) return deny("REASON_REQUIRED", reasonErr, 400);
    const hash = sha256Hex(JSON.stringify({ confirm: true, reason: reason.trim() }));
    const prior = beginCommand(db, { userId: actorId, scope: "admin-pvp-abort", key: commandKey, hash });
    if (prior) return prior;
    const preview = activeCounts(db);
    const rows = db.prepare(
      `SELECT id FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`
    ).all();
    for (const row of rows) {
      const finished = finishMatchInTx(db, { matchId: row.id, terminalType: "aborted", reason: "admin_abort", now });
      if (!finished.ok) throw new Error(finished.message || "pvp abort failed");
    }
    writeAuditLog({
      actorId,
      action: "pvp.abort_active",
      targetType: "pvp_runtime",
      targetId: "active",
      reason: reason.trim(),
      before: { status: "playing" },
      after: { status: "aborted" },
      requestId,
    });
    const ack = {
      ok: true,
      confirmRequired: false,
      aborted: rows.length,
      rooms: preview.rooms,
      refundHeadcount: preview.refundHeadcount,
      matchIds: rows.map((row) => row.id),
    };
    storeCommand(db, {
      userId: actorId, scope: "admin-pvp-abort", key: commandKey, hash, resourceId: "active", ack, now,
    });
    return ack;
  });
}

export function notifyAborted(matchIds) {
  for (const matchId of matchIds || []) noteMatchChanged(matchId);
}
