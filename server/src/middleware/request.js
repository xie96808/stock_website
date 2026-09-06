import { config, newRequestId } from "../lib/config.js";
import { deriveCsrfToken, timingSafeEqualStr } from "../lib/crypto.js";
import { findValidSession } from "../lib/sessions.js";
import { publicUser } from "../lib/users.js";
import { fail } from "../lib/http.js";

export function attachRequestId(req, res, next) {
  res.locals.requestId = newRequestId();
  res.setHeader("X-Request-Id", res.locals.requestId);
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function loadSession(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  const row = findValidSession(token);
  if (row) {
    req.sessionToken = token;
    req.session = row;
    req.user = publicUser(row);
    req.csrfToken = deriveCsrfToken(token);
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return fail(res, 401, "UNAUTHORIZED", "未登录或会话已过期");
  if (req.user.status === "disabled") return fail(res, 403, "ACCOUNT_DISABLED", "账号已禁用");
  next();
}

function originOk(req) {
  const origin = req.get("origin");
  if (!origin) {
    const host = (req.get("host") || "").split(":")[0];
    if (!config.isProd && (host === "127.0.0.1" || host === "localhost")) return true;
    return req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  }
  return config.originAllowlist.includes(origin);
}

export function checkOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!originOk(req)) return fail(res, 403, "ORIGIN_DENIED", "来源不被允许");
  next();
}

export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.sessionToken) return next(); // login/register path may not have session
  const header = req.get("x-csrf-token") || "";
  if (!timingSafeEqualStr(header, req.csrfToken || "")) {
    return fail(res, 403, "CSRF_FAILED", "CSRF 校验失败");
  }
  next();
}
