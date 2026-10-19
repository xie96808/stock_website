import { Router } from "express";
import { randomInt } from "node:crypto";
import { verifyPassword, hashPassword } from "../lib/crypto.js";
import { findUserById, updatePassword } from "../lib/users.js";
import { revokeAllUserSessions } from "../lib/sessions.js";
import { writeAuditLog } from "../lib/audit.js";
import { consumeRateLimit, rateLimitFail } from "../lib/rateLimit.js";
import { readMyStats } from "../lib/pvp/lobby.js";
import {
  setAdminVerified,
  isAdminVerified,
  ADMIN_VERIFY_MS,
} from "../lib/sessions.js";
import {
  searchUsers,
  getAdminUser,
  setUserStatus,
  adminSoftDeleteUser,
  adminRestoreUser,
  searchGames,
  getAdminGame,
  moderateGame,
  getAdminOverview,
} from "../lib/admin.js";
import { listAuditLogs } from "../lib/audit.js";
import { adminAdjustJiuCoin, dailyClaimStatus } from "../lib/jiuCoin.js";
import {
  listAdminAnnouncements,
  getAdminAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  archiveAnnouncement,
} from "../lib/announcements.js";
import {
  listAdminFeedback,
  getAdminFeedback,
  updateFeedbackStatus,
  resolveFeedbackImage,
} from "../lib/feedback.js";
import { detectImageMime } from "../lib/avatars.js";
import { listAppSettings, updateAppSetting } from "../lib/appSettings.js";
import {
  adminContentOverview,
  adminDailyBoard,
  adminDailySetHidden,
  adminListShares,
  adminRevokeShare,
  adminScheduleAnnouncement,
  adminCancelSchedule,
  scheduledAnnouncementMap,
  adminFeedbackUnread,
  adminFeedbackNote,
  adminSetFeedbackNote,
} from "../lib/adminContent.js";
import { seedNearDailyChallenges } from "../lib/dailyChallenge.js";
import { seedAllPuzzleChapters } from "../lib/puzzleChapter.js";
import fs from "node:fs";
import { ok, fail } from "../lib/http.js";
import {
  requireAdminGate,
  requireAdmin,
  requireAdminVerified,
} from "../middleware/admin.js";
import {
  adminGetConfig,
  adminPreviewConfig,
  adminSaveConfig,
  adminListSpins,
  adminStats,
  adminGrantSpins,
  adminUserWheel,
} from "../lib/luckyWheel.js";
import { openDb } from "../db/connection.js";
import {
  adminAbortActive,
  adminAbortPreview,
  adminListMatches,
  adminListReports,
  adminMatchDetail,
  adminOverview,
  adminSetDrain,
  adminUpdateReport,
  notifyAborted,
} from "../lib/pvp/reports.js";

const router = Router();

router.use("/admin", requireAdminGate, requireAdmin);

router.post("/admin/reauth", async (req, res) => {
  const password = req.body?.password;
  if (typeof password !== "string") {
    return fail(res, 400, "INVALID_PASSWORD", "请输入当前密码");
  }
  const row = findUserById(req.user.id);
  if (!row) return fail(res, 401, "UNAUTHORIZED", "未登录或会话已过期");
  const good = await verifyPassword(row.password_hash, password);
  if (!good) return fail(res, 401, "INVALID_CREDENTIALS", "密码错误");
  const verifiedAt = setAdminVerified(req.sessionToken);
  req.session.admin_verified_at = verifiedAt;
  return ok(res, {
    verifiedAt,
    expiresInMs: ADMIN_VERIFY_MS,
  });
});

router.get("/admin/overview", (req, res) => {
  return ok(res, getAdminOverview());
});

router.get("/admin/session", (req, res) => {
  return ok(res, {
    user: req.user,
    adminVerified: isAdminVerified(req.session),
    expiresInMs: ADMIN_VERIFY_MS,
  });
});

router.get("/admin/users", (req, res) => {
  const data = searchUsers({
    q: req.query.q,
    status: req.query.status,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  return ok(res, data);
});

router.get("/admin/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const data = getAdminUser(id);
  if (!data) return fail(res, 404, "NOT_FOUND", "用户不存在");
  let pvp = null;
  try {
    pvp = readMyStats(openDb(), id);
  } catch {
    pvp = null;
  }
  return ok(res, { ...data, pvp });
});

// Unambiguous alphabet (no 0/O/1/l/I) for one-time temporary passwords.
const TEMP_PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateTempPassword(len = 12) {
  let out = "";
  for (let i = 0; i < len; i += 1) out += TEMP_PW_ALPHABET[randomInt(TEMP_PW_ALPHABET.length)];
  // Guarantee at least one digit and one letter so it passes validatePassword.
  return `${out.slice(0, len - 2)}${TEMP_PW_ALPHABET[randomInt(23)]}${"23456789"[randomInt(8)]}`;
}

/**
 * Admin resets a regular user's password to a one-time temporary password.
 * Reauth + CSRF required; refuses admins and self (use CLI or /me/password).
 * The temp password is returned once and never logged or audited.
 */
router.post("/admin/users/:id/password-reset", requireAdminVerified, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) return fail(res, 400, "REASON_REQUIRED", "请填写原因");
  if (reason.length > 200) return fail(res, 400, "REASON_TOO_LONG", "原因过长");
  const byAdmin = consumeRateLimit(`admin-pwreset:actor:${req.user.id}`, 10, 10 * 60 * 1000);
  if (!byAdmin.ok) return rateLimitFail(res, byAdmin.retryAfterSec, "重置过于频繁，请稍后再试");
  const row = findUserById(id);
  if (!row) return fail(res, 404, "NOT_FOUND", "用户不存在");
  if (row.id === req.user.id) return fail(res, 409, "SELF_RESET", "不能在这里重置自己的密码，请用「修改我的密码」");
  if (row.role === "admin") return fail(res, 409, "ADMIN_TARGET", "管理员密码只能用服务器命令行重置");
  if (row.status === "deleted" || row.password_hash === "!") return fail(res, 409, "USER_DELETED", "已注销账号不能重置密码");
  const byTarget = consumeRateLimit(`admin-pwreset:target:${id}`, 3, 10 * 60 * 1000);
  if (!byTarget.ok) return rateLimitFail(res, byTarget.retryAfterSec, "该账号刚重置过，请稍后再试");
  const tempPassword = generateTempPassword();
  updatePassword(id, await hashPassword(tempPassword));
  revokeAllUserSessions(id);
  writeAuditLog({
    actorId: req.user.id,
    action: "user.password_reset",
    targetType: "user",
    targetId: String(id),
    reason,
    requestId: res.locals.requestId,
  });
  res.set("Cache-Control", "no-store");
  return ok(res, { userId: id, username: row.username_normalized, tempPassword, sessionsRevoked: true });
});

router.post("/admin/users/:id/jiu-coin", requireAdminVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const result = adminAdjustJiuCoin({
    actorId: req.user.id,
    targetUserId: id,
    op: req.body?.op,
    amount: req.body?.amount,
    reason: req.body?.reason,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

router.get("/admin/users/:id/jiu-coin", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const data = getAdminUser(id);
  if (!data) return fail(res, 404, "NOT_FOUND", "用户不存在");
  return ok(res, {
    userId: id,
    balance: data.user.jiuCoinBalance,
    daily: dailyClaimStatus(id),
    wheel: adminUserWheel(id),
  });
});

router.patch("/admin/users/:id/status", requireAdminVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const result = setUserStatus({
    actorId: req.user.id,
    targetUserId: id,
    status: req.body?.status,
    reason: req.body?.reason,
    expectedUpdatedAt: req.body?.expectedUpdatedAt ?? null,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});


router.post("/admin/users/:id/soft-delete", requireAdminVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const result = adminSoftDeleteUser({
    actorId: req.user.id,
    targetUserId: id,
    reason: req.body?.reason,
    expectedUpdatedAt: req.body?.expectedUpdatedAt ?? null,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.post("/admin/users/:id/restore", requireAdminVerified, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return fail(res, 400, "INVALID_ID", "用户 ID 无效");
  const result = adminRestoreUser({
    actorId: req.user.id,
    targetUserId: id,
    reason: req.body?.reason,
    expectedUpdatedAt: req.body?.expectedUpdatedAt ?? null,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.get("/admin/games", (req, res) => {
  const data = searchGames({
    q: req.query.q,
    fillMode: req.query.fillMode,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  return ok(res, data);
});

router.get("/admin/games/:id", (req, res) => {
  const data = getAdminGame(req.params.id);
  if (!data) return fail(res, 404, "NOT_FOUND", "战绩不存在");
  return ok(res, { game: data });
});

router.patch("/admin/games/:id/moderation", requireAdminVerified, (req, res) => {
  const result = moderateGame({
    actorId: req.user.id,
    gameId: req.params.id,
    action: req.body?.action,
    reason: req.body?.reason,
    expectedModeratedAt: req.body?.expectedModeratedAt,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.get("/admin/audit-logs", (req, res) => {
  const data = listAuditLogs({
    actorId: req.query.actorId != null ? Number(req.query.actorId) : undefined,
    targetType: req.query.targetType,
    targetId: req.query.targetId,
    action: req.query.action,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  return ok(res, data);
});

router.get("/admin/announcements", (req, res) => {
  const data = listAdminAnnouncements({
    status: req.query.status,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  return ok(res, data);
});

function parseAnnouncementId(raw) {
  const id = Number(raw);
  // Number("") === 0; reject non-positive so empty/0/-1 never look like a real row.
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

router.get("/admin/announcements/:id", (req, res) => {
  const id = parseAnnouncementId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "公告 ID 无效");
  const data = getAdminAnnouncement(id);
  if (!data) return fail(res, 404, "NOT_FOUND", "公告不存在");
  return ok(res, { announcement: data });
});

router.post("/admin/announcements", requireAdminVerified, (req, res) => {
  const result = createAnnouncement({
    actorId: req.user.id,
    title: req.body?.title ?? null,
    body: req.body?.body,
    status: req.body?.status ?? "draft",
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.patch("/admin/announcements/:id", requireAdminVerified, (req, res) => {
  const id = parseAnnouncementId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "公告 ID 无效");
  const result = updateAnnouncement({
    actorId: req.user.id,
    id,
    title: req.body?.title,
    body: req.body?.body,
    status: req.body?.status,
    expectedUpdatedAt: req.body?.expectedUpdatedAt ?? null,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.post("/admin/announcements/:id/archive", requireAdminVerified, (req, res) => {
  const id = parseAnnouncementId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "公告 ID 无效");
  const result = archiveAnnouncement({
    actorId: req.user.id,
    id,
    expectedUpdatedAt: req.body?.expectedUpdatedAt ?? null,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});


function parseFeedbackId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

router.get("/admin/feedback", (req, res) => {
  const data = listAdminFeedback({
    status: req.query.status,
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  if (data.error) {
    return fail(res, data.error.status, data.error.code, data.error.message);
  }
  return ok(res, data);
});

router.get("/admin/feedback/:id", (req, res) => {
  const id = parseFeedbackId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "反馈 ID 无效");
  const data = getAdminFeedback(id);
  if (!data) return fail(res, 404, "NOT_FOUND", "反馈不存在");
  return ok(res, { feedback: data, adminNote: adminFeedbackNote(openDb(), id) });
});

router.patch("/admin/feedback/:id", requireAdminVerified, (req, res) => {
  const id = parseFeedbackId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "反馈 ID 无效");
  const result = updateFeedbackStatus({
    actorId: req.user.id,
    id,
    status: req.body?.status,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

router.get("/admin/feedback-images/:filename", (req, res) => {
  const resolved = resolveFeedbackImage(req.params.filename);
  if (!resolved) return fail(res, 404, "NOT_FOUND", "图片不存在");
  let mime = resolved.mime || "application/octet-stream";
  try {
    const fd = fs.openSync(resolved.filePath, "r");
    try {
      const head = Buffer.alloc(12);
      const n = fs.readSync(fd, head, 0, 12, 0);
      mime = detectImageMime(head.subarray(0, n)) || mime;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return fail(res, 404, "NOT_FOUND", "图片不存在");
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, max-age=3600");
  return res.sendFile(resolved.filePath);
});


const PVP_FORBIDDEN = ["returnPpm", "return_ppm", "winnerUserId", "winner_user_id", "deleteLedger", "ledger"];

function pvpAdminBody(req, res) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    fail(res, 400, "BAD_PAYLOAD", "请求格式无效");
    return null;
  }
  if (PVP_FORBIDDEN.some((key) => Object.prototype.hasOwnProperty.call(req.body, key))) {
    fail(res, 400, "BAD_PAYLOAD", "不能修改收益或流水");
    return null;
  }
  return req.body;
}

function pvpAdminResult(res, result) {
  if (!result?.ok) return fail(res, result?.status || 400, result?.code || "BAD_REQUEST", result?.message || "请求无效");
  return ok(res, result);
}

router.get("/admin/pvp/overview", (req, res) => {
  return ok(res, adminOverview(openDb()));
});

router.get("/admin/pvp/matches", (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  return ok(res, adminListMatches(openDb(), {
    status: req.query.status || "",
    cursor: req.query.cursor || "",
    limit,
  }));
});

router.get("/admin/pvp/matches/:id", (req, res) => {
  const data = adminMatchDetail(openDb(), req.params.id);
  if (!data) return fail(res, 404, "NOT_FOUND", "对局不存在");
  return ok(res, data);
});

router.get("/admin/pvp/reports", (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  return ok(res, adminListReports(openDb(), {
    status: req.query.status || "open",
    cursor: req.query.cursor || "",
    limit,
  }));
});

router.patch("/admin/pvp/reports/:id", requireAdminVerified, (req, res) => {
  const body = pvpAdminBody(req, res);
  if (!body) return;
  const reportId = Number(req.params.id);
  if (!Number.isInteger(reportId)) return fail(res, 400, "INVALID_ID", "举报 ID 无效");
  const result = adminUpdateReport(openDb(), {
    reportId,
    actorId: req.user.id,
    status: body.status,
    resolution: body.resolution,
    reason: body.reason,
    commandKey: req.get("idempotency-key") || "",
    requestId: res.locals.requestId,
    now: Date.now(),
  });
  return pvpAdminResult(res, result);
});

router.post("/admin/pvp/drain", requireAdminVerified, (req, res) => {
  const body = pvpAdminBody(req, res);
  if (!body) return;
  const result = adminSetDrain(openDb(), {
    actorId: req.user.id,
    draining: body.drain,
    reason: body.reason,
    commandKey: req.get("idempotency-key") || "",
    requestId: res.locals.requestId,
    now: Date.now(),
  });
  return pvpAdminResult(res, result);
});

router.post("/admin/pvp/abort-active", requireAdminVerified, (req, res) => {
  const body = pvpAdminBody(req, res);
  if (!body) return;
  if (body.confirm !== true) return ok(res, adminAbortPreview(openDb()));
  const result = adminAbortActive(openDb(), {
    actorId: req.user.id,
    reason: body.reason,
    commandKey: req.get("idempotency-key") || "",
    requestId: res.locals.requestId,
    now: Date.now(),
  });
  if (result?.ok) notifyAborted(result.matchIds);
  return pvpAdminResult(res, result);
});

/* ---- runtime settings (feature switches / PvP params) ---- */
router.get("/admin/settings", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return ok(res, { items: listAppSettings(openDb()) });
});

const SEED_ON_ENABLE = {
  dailyChallengeEnabled: () => seedNearDailyChallenges(),
  ghostDuelEnabled: () => seedNearDailyChallenges(),
  puzzleChapterEnabled: () => seedAllPuzzleChapters(),
};

router.put("/admin/settings/:key", requireAdminVerified, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (!("value" in body)) return fail(res, 400, "BAD_PAYLOAD", "缺少 value（null 表示恢复环境默认）");
  const key = String(req.params.key || "");
  const result = updateAppSetting(openDb(), {
    key,
    value: body.value,
    actorId: req.user.id,
    reason: body.reason,
    requestId: res.locals.requestId,
  });
  if (!result.ok) return fail(res, result.status || 400, result.code, result.message);
  if (result.setting.value === true && SEED_ON_ENABLE[key]) {
    try {
      SEED_ON_ENABLE[key]();
    } catch (e) {
      console.warn(`seed after enabling ${key} failed:`, e.message || e);
    }
  }
  return ok(res, { setting: result.setting });
});

/* ---- batch 3: content, daily board, shares, scheduling, feedback notes ---- */
const result3 = (res, r) => (r.ok ? ok(res, r) : fail(res, r.status || 400, r.code, r.message));

router.get("/admin/content/overview", (req, res) => ok(res, adminContentOverview(openDb())));

router.get("/admin/daily/board", (req, res) => result3(res, adminDailyBoard(openDb(), { date: req.query.date || "" })));

router.patch("/admin/daily/attempts/:id", requireAdminVerified, (req, res) =>
  result3(res, adminDailySetHidden(openDb(), {
    attemptId: String(req.params.id),
    hide: req.body?.hide,
    actorId: req.user.id,
    reason: req.body?.reason,
    requestId: res.locals.requestId,
  })));

router.get("/admin/pvp/shares", (req, res) => {
  const limit = Number(req.query.limit || 20);
  if (!Number.isFinite(limit) || limit < 1 || limit > 50) return fail(res, 400, "BAD_PAYLOAD", "列表长度无效");
  return ok(res, adminListShares(openDb(), { status: req.query.status || "", cursor: req.query.cursor || "", limit }));
});

router.post("/admin/pvp/shares/:code/revoke", requireAdminVerified, (req, res) =>
  result3(res, adminRevokeShare(openDb(), {
    code: String(req.params.code),
    actorId: req.user.id,
    reason: req.body?.reason,
    requestId: res.locals.requestId,
  })));

router.post("/admin/announcements/:id/schedule", requireAdminVerified, (req, res) => {
  const id = parseAnnouncementId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "公告 ID 无效");
  return result3(res, adminScheduleAnnouncement(openDb(), {
    id,
    publishAt: req.body?.publishAt,
    actorId: req.user.id,
    requestId: res.locals.requestId,
  }));
});

router.delete("/admin/announcements/:id/schedule", requireAdminVerified, (req, res) => {
  const id = parseAnnouncementId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "公告 ID 无效");
  return result3(res, adminCancelSchedule(openDb(), { id, actorId: req.user.id, requestId: res.locals.requestId }));
});

router.get("/admin/announcements-scheduled", (req, res) => ok(res, { scheduled: scheduledAnnouncementMap(openDb()) }));

router.get("/admin/feedback-unread", (req, res) => ok(res, adminFeedbackUnread(openDb())));

router.put("/admin/feedback/:id/note", requireAdminVerified, (req, res) => {
  const id = parseFeedbackId(req.params.id);
  if (id == null) return fail(res, 400, "INVALID_ID", "反馈 ID 无效");
  return result3(res, adminSetFeedbackNote(openDb(), {
    id,
    note: req.body?.note,
    actorId: req.user.id,
    requestId: res.locals.requestId,
  }));
});

/* ---- 幸运转盘 (lucky wheel). Enable switch = PUT /admin/settings/luckyWheelEnabled ---- */
function wheelResult(res, r, extra = {}) {
  if (!r.ok) {
    const body = { error: { code: r.code, message: r.message, ...(r.ev ? { ev: r.ev } : {}) }, requestId: res.locals.requestId };
    return res.status(r.status || 400).json(body);
  }
  const { ok: _ok, status: _status, ...rest } = r;
  return ok(res, { ...rest, ...extra });
}

router.get("/admin/lucky-wheel", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return ok(res, adminGetConfig());
});

router.post("/admin/lucky-wheel/config/preview", (req, res) => {
  return wheelResult(res, adminPreviewConfig(req.body));
});

router.put("/admin/lucky-wheel/config", requireAdminVerified, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return wheelResult(
    res,
    adminSaveConfig({
      actorId: req.user.id,
      input: body,
      restoreVersion: body.restoreVersion ?? null,
      reason: body.reason,
      requestId: res.locals.requestId,
    })
  );
});

router.get("/admin/lucky-wheel/spins", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return wheelResult(res, adminListSpins(req.query || {}));
});

router.get("/admin/lucky-wheel/stats", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return ok(res, adminStats({ days: req.query?.days }));
});

router.post("/admin/lucky-wheel/grant", requireAdminVerified, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return wheelResult(
    res,
    adminGrantSpins({
      actorId: req.user.id,
      userId: body.userId,
      spins: body.spins,
      reason: body.reason,
      expiresDate: body.expiresDate ?? null,
      opKey: req.get("Idempotency-Key") || body.opKey || null,
      requestId: res.locals.requestId,
    })
  );
});

export default router;
