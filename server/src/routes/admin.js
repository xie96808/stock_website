import { Router } from "express";
import { verifyPassword } from "../lib/crypto.js";
import { findUserById } from "../lib/users.js";
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
import { ok, fail } from "../lib/http.js";
import {
  requireAdminGate,
  requireAdmin,
  requireAdminVerified,
} from "../middleware/admin.js";

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
  return ok(res, data);
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


export default router;
