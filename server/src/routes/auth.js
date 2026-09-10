import fs from "node:fs";
import { Router } from "express";
import {
  hashPassword, verifyPassword,
} from "../lib/crypto.js";
import {
  normalizeUsername, validatePassword, normalizeNickname, validateAvatarId,
} from "../lib/validate.js";
import {
  findUserByUsername, insertUser, publicUser, updatePassword, softDeleteUser, findUserById, updateUserProfile,
  updateAvatarCustomPath,
} from "../lib/users.js";
import {
  createSession, setSessionCookie, clearSessionCookie, revokeSessionToken, revokeAllUserSessions,
} from "../lib/sessions.js";
import { ok, fail } from "../lib/http.js";
import { config } from "../lib/config.js";
import {
  clientIp, checkLoginFailLimits, recordLoginFailure, checkRegisterLimits, rateLimitFail,
} from "../lib/rateLimit.js";
import { requireUser } from "../middleware/request.js";
import { claimDaily, dailyClaimStatus } from "../lib/jiuCoin.js";
import {
  readMultipartAvatar, saveAvatarBuffer, isSafeAvatarId, avatarFilePath, detectImageMime,
} from "../lib/avatars.js";

const router = Router();

function randomAvatarId() {
  return 1 + Math.floor(Math.random() * 12);
}

router.post("/auth/register", async (req, res) => {
  if (!config.registrationEnabled) {
    return fail(res, 403, "REGISTRATION_DISABLED", "当前暂停注册");
  }
  const ip = clientIp(req);
  const regLimit = checkRegisterLimits(ip);
  if (regLimit.limited) {
    return rateLimitFail(res, regLimit.retryAfterSec, regLimit.message);
  }
  const username = normalizeUsername(req.body?.username);
  if (!username) return fail(res, 400, "INVALID_USERNAME", "用户名不合法（4-24位，字母开头）");
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) return fail(res, 400, "INVALID_PASSWORD", pwErr);
  const nickname = normalizeNickname(req.body?.nickname);
  if (!nickname) return fail(res, 400, "INVALID_NICKNAME", "昵称须为 2-16 字（勿含控制字符）");
  if (!req.body?.termsVersion) return fail(res, 400, "TERMS_REQUIRED", "请确认服务条款");
  if (findUserByUsername(username)) return fail(res, 409, "USERNAME_TAKEN", "用户名已被占用");

  let avatarId = randomAvatarId();
  if (req.body?.avatarId != null) {
    const av = validateAvatarId(req.body.avatarId);
    if (!av) return fail(res, 400, "INVALID_AVATAR", "头像 ID 须为 1-12");
    avatarId = av;
  }

  const passwordHash = await hashPassword(req.body.password);
  // Product: new registrations participate in the leaderboard by default (opt-out in 资料设置).
  // Explicit false still opts out. Existing DB rows are not mass-migrated.
  const leaderboardOptIn = req.body?.leaderboardOptIn == null
    ? true
    : !!req.body.leaderboardOptIn;
  let user;
  try {
    user = insertUser({ username, passwordHash, nickname, avatarId, leaderboardOptIn });
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) return fail(res, 409, "USERNAME_TAKEN", "用户名已被占用");
    throw e;
  }
  const sess = createSession(user.id);
  setSessionCookie(res, sess.sessionToken);
  return ok(res, { user: publicUser(user), csrfToken: sess.csrfToken }, 201);
});

router.post("/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;
  const ip = clientIp(req);
  if (!username || typeof password !== "string") {
    return fail(res, 400, "INVALID_CREDENTIALS", "账号或密码错误");
  }
  const failLimit = checkLoginFailLimits(username || "_", ip);
  if (failLimit.limited) {
    return rateLimitFail(res, failLimit.retryAfterSec, failLimit.message);
  }
  const row = findUserByUsername(username);
  const good = row && row.status === "active" && (await verifyPassword(row.password_hash, password));
  if (!good) {
    recordLoginFailure(username || "_", ip);
    return fail(res, 401, "INVALID_CREDENTIALS", "账号或密码错误");
  }
  if (req.sessionToken) revokeSessionToken(req.sessionToken);
  const sess = createSession(row.id);
  setSessionCookie(res, sess.sessionToken);
  return ok(res, { user: publicUser(row), csrfToken: sess.csrfToken });
});

router.post("/auth/logout", (req, res) => {
  revokeSessionToken(req.sessionToken);
  clearSessionCookie(res);
  return ok(res, null, 204);
});

router.get("/me", requireUser, (req, res) => {
  return ok(res, { user: req.user, csrfToken: req.csrfToken });
});

router.get("/me/jiu-coin", requireUser, (req, res) => {
  return ok(res, dailyClaimStatus(req.user.id));
});

router.post("/me/jiu-coin/daily", requireUser, (req, res) => {
  const result = claimDaily(req.user.id);
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message, result.error.details);
  }
  return ok(res, result.data, result.status);
});

router.patch("/me", requireUser, (req, res) => {
  const patch = {};
  if (req.body?.nickname != null) {
    const nn = normalizeNickname(req.body.nickname);
    if (!nn) return fail(res, 400, "INVALID_NICKNAME", "昵称须为 2-16 字（勿含控制字符）");
    patch.nickname = nn;
  }
  if (req.body?.avatarId != null) {
    const av = validateAvatarId(req.body.avatarId);
    if (!av) return fail(res, 400, "INVALID_AVATAR", "头像 ID 须为 1-12");
    patch.avatarId = av;
  }
  if (req.body?.leaderboardOptIn != null) {
    patch.leaderboardOptIn = !!req.body.leaderboardOptIn;
  }
  const updated = updateUserProfile(req.user.id, patch);
  return ok(res, { user: publicUser(updated) });
});

router.post("/me/avatar", requireUser, async (req, res) => {
  const parsed = await readMultipartAvatar(req);
  if (parsed.error) {
    return fail(res, parsed.error.status, parsed.error.code, parsed.error.message);
  }
  const saved = saveAvatarBuffer(parsed.buffer);
  if (saved.error) {
    return fail(res, saved.error.status, saved.error.code, saved.error.message);
  }
  const prev = findUserById(req.user.id);
  const updated = updateAvatarCustomPath(req.user.id, saved.filename);
  if (prev?.avatar_custom_path && prev.avatar_custom_path !== saved.filename) {
    const oldPath = avatarFilePath(prev.avatar_custom_path);
    if (oldPath) {
      try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
    }
  }
  return ok(res, { user: publicUser(updated) });
});

router.get("/avatars/:id", (req, res) => {
  const id = req.params.id;
  if (!isSafeAvatarId(id)) {
    return fail(res, 404, "NOT_FOUND", "头像不存在");
  }
  const filePath = avatarFilePath(id);
  if (!filePath || !fs.existsSync(filePath)) {
    return fail(res, 404, "NOT_FOUND", "头像不存在");
  }
  // Peek magic bytes only (avoid readFileSync of whole image on request path).
  const fd = fs.openSync(filePath, "r");
  let mime = "application/octet-stream";
  try {
    const head = Buffer.alloc(12);
    const n = fs.readSync(fd, head, 0, 12, 0);
    mime = detectImageMime(head.subarray(0, n)) || mime;
  } finally {
    fs.closeSync(fd);
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  return res.sendFile(filePath);
});

router.post("/me/password", requireUser, async (req, res) => {
  const row = findUserById(req.user.id);
  const cur = req.body?.currentPassword;
  const pwErr = validatePassword(req.body?.newPassword);
  if (typeof cur !== "string" || !(await verifyPassword(row.password_hash, cur))) {
    return fail(res, 401, "BAD_PASSWORD", "当前密码不正确");
  }
  if (pwErr) return fail(res, 400, "INVALID_PASSWORD", pwErr);
  updatePassword(row.id, await hashPassword(req.body.newPassword));
  revokeAllUserSessions(row.id);
  clearSessionCookie(res);
  return ok(res, null, 204);
});

router.delete("/me", requireUser, async (req, res) => {
  const row = findUserById(req.user.id);
  const cur = req.body?.currentPassword;
  if (req.body?.confirmation !== "DELETE") {
    return fail(res, 400, "CONFIRMATION_REQUIRED", "请确认 confirmation=DELETE");
  }
  if (typeof cur !== "string" || !(await verifyPassword(row.password_hash, cur))) {
    return fail(res, 401, "BAD_PASSWORD", "当前密码不正确");
  }
  softDeleteUser(row.id, { wipeCredentials: true, source: "self", reason: "self_delete" });
  revokeAllUserSessions(row.id);
  clearSessionCookie(res);
  return ok(res, null, 204);
});

export default router;
