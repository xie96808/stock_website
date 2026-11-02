import { config, newRequestId } from "../lib/config.js";
import { deriveCsrfToken, timingSafeEqualStr } from "../lib/crypto.js";
import { findValidSession } from "../lib/sessions.js";
import { publicUser, withGuestFields } from "../lib/users.js";
import { fail } from "../lib/http.js";
import { httpOriginAllowed } from "../lib/origin.js";

export function attachRequestId(req, res, next) {
  res.locals.requestId = newRequestId();
  res.setHeader("X-Request-Id", res.locals.requestId);
  // Avatar binaries are immutable content-addressed files; allow browser cache.
  const isAvatarGet = req.method === "GET" && /^\/api\/v1\/avatars\//.test(req.path);
  if (!isAvatarGet) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}

export function loadSession(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  const row = findValidSession(token);
  if (row) {
    req.sessionToken = token;
    req.session = row;
    req.user = withGuestFields(publicUser(row));
    req.csrfToken = deriveCsrfToken(token);
  }
  next();
}

/**
 * Registered users only. Guests (游客先玩) are rejected here BY DEFAULT, so every existing and future route that uses
 * requireUser is closed to guests; the few game routes a guest may use opt in with requireUserOrGuest.
 */
export function requireUser(req, res, next) {
  if (!req.user) return fail(res, 401, "UNAUTHORIZED", "未登录或会话已过期");
  if (req.user.status === "disabled") return fail(res, 403, "ACCOUNT_DISABLED", "账号已禁用");
  if (req.user.isGuest) return fail(res, 403, "GUEST_RESTRICTED", "游客不能使用该功能，请先注册");
  next();
}

/** A registered user or a guest. Only for the routes a guest legitimately needs (one classic game). */
export function requireUserOrGuest(req, res, next) {
  if (!req.user) return fail(res, 401, "UNAUTHORIZED", "未登录或会话已过期");
  if (req.user.status === "disabled") return fail(res, 403, "ACCOUNT_DISABLED", "账号已禁用");
  next();
}

function originOk(req) {
  return httpOriginAllowed({
    origin: req.get("origin"),
    host: req.get("host"),
    method: req.method,
    allowlist: config.originAllowlist,
    isProd: config.isProd,
  });
}

export function checkOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!originOk(req)) return fail(res, 403, "ORIGIN_DENIED", "来源不被允许");
  next();
}

/** POST login/register must work even if an old session cookie is present (admin/main login omit CSRF). Logout and other writes still require CSRF when a session exists. */
export function isCsrfExemptAuthWrite(req) {
  const p = req.path || "";
  return req.method === "POST" && (p.endsWith("/auth/login") || p.endsWith("/auth/register") || p.endsWith("/auth/guest"));
}

export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.sessionToken) return next(); // no session → nothing to bind CSRF to
  if (isCsrfExemptAuthWrite(req)) return next();
  const header = req.get("x-csrf-token") || "";
  if (!timingSafeEqualStr(header, req.csrfToken || "")) {
    return fail(res, 403, "CSRF_FAILED", "CSRF 校验失败");
  }
  next();
}
