import { Router } from "express";
import {
  hashPassword, verifyPassword, randomToken, hashRecoveryCode, timingSafeEqualStr,
} from "../lib/crypto.js";
import {
  normalizeUsername, validatePassword, normalizeNickname, validateAvatarId,
} from "../lib/validate.js";
import {
  findUserByUsername, insertUser, publicUser, updatePassword, updateRecoveryHash, softDeleteUser, findUserById, updateUserProfile,
} from "../lib/users.js";
import {
  createSession, setSessionCookie, clearSessionCookie, revokeSessionToken, revokeAllUserSessions,
} from "../lib/sessions.js";
import { ok, fail } from "../lib/http.js";
import { requireUser } from "../middleware/request.js";

const router = Router();

function randomAvatarId() {
  return 1 + Math.floor(Math.random() * 12);
}

router.post("/auth/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  if (!username) return fail(res, 400, "INVALID_USERNAME", "用户名不合法（4-24位，字母开头）");
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) return fail(res, 400, "INVALID_PASSWORD", pwErr);
  const nickname = normalizeNickname(req.body?.nickname);
  if (!nickname) return fail(res, 400, "INVALID_NICKNAME", "昵称不合法（2-16字）");
  if (!req.body?.termsVersion) return fail(res, 400, "TERMS_REQUIRED", "请确认服务条款");
  if (findUserByUsername(username)) return fail(res, 409, "USERNAME_TAKEN", "用户名已被占用");

  const passwordHash = await hashPassword(req.body.password);
  const recoveryCode = randomToken(24);
  const recoveryCodeHash = hashRecoveryCode(recoveryCode);
  const avatarId = randomAvatarId();
  const leaderboardOptIn = !!req.body?.leaderboardOptIn;
  let user;
  try {
    user = insertUser({ username, passwordHash, nickname, avatarId, leaderboardOptIn, recoveryCodeHash });
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) return fail(res, 409, "USERNAME_TAKEN", "用户名已被占用");
    throw e;
  }
  const sess = createSession(user.id);
  setSessionCookie(res, sess.sessionToken);
  return ok(res, { user: publicUser(user), csrfToken: sess.csrfToken, recoveryCode }, 201);
});

router.post("/auth/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;
  if (!username || typeof password !== "string") {
    return fail(res, 400, "INVALID_CREDENTIALS", "账号或密码错误");
  }
  const row = findUserByUsername(username);
  const good = row && row.status === "active" && (await verifyPassword(row.password_hash, password));
  if (!good) return fail(res, 401, "INVALID_CREDENTIALS", "账号或密码错误");
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

router.post("/auth/recover", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const recoveryCode = req.body?.recoveryCode;
  const pwErr = validatePassword(req.body?.newPassword);
  if (!username || typeof recoveryCode !== "string") {
    return fail(res, 400, "INVALID_RECOVERY", "账号或恢复码错误");
  }
  if (pwErr) return fail(res, 400, "INVALID_PASSWORD", pwErr);
  const row = findUserByUsername(username);
  const expected = row?.recovery_code_hash || "";
  const provided = hashRecoveryCode(recoveryCode);
  const match = row && row.status === "active" && expected && timingSafeEqualStr(expected, provided);
  if (!match) return fail(res, 401, "INVALID_RECOVERY", "账号或恢复码错误");
  const passwordHash = await hashPassword(req.body.newPassword);
  const newCode = randomToken(24);
  updatePassword(row.id, passwordHash);
  updateRecoveryHash(row.id, hashRecoveryCode(newCode));
  revokeAllUserSessions(row.id);
  clearSessionCookie(res);
  return ok(res, { recoveryCode: newCode });
});

router.get("/me", requireUser, (req, res) => {
  return ok(res, { user: req.user, csrfToken: req.csrfToken });
});

router.patch("/me", requireUser, (req, res) => {
  const patch = {};
  if (req.body?.nickname != null) {
    const nn = normalizeNickname(req.body.nickname);
    if (!nn) return fail(res, 400, "INVALID_NICKNAME", "昵称不合法（2-16字）");
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

router.post("/me/recovery-code", requireUser, async (req, res) => {
  const row = findUserById(req.user.id);
  const cur = req.body?.currentPassword;
  if (typeof cur !== "string" || !(await verifyPassword(row.password_hash, cur))) {
    return fail(res, 401, "BAD_PASSWORD", "当前密码不正确");
  }
  const newCode = randomToken(24);
  updateRecoveryHash(row.id, hashRecoveryCode(newCode));
  return ok(res, { recoveryCode: newCode });
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
  softDeleteUser(row.id);
  revokeAllUserSessions(row.id);
  clearSessionCookie(res);
  return ok(res, null, 204);
});

export default router;
