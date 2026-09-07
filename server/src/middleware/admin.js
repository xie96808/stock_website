import { config } from "../lib/config.js";
import { fail } from "../lib/http.js";
import { requireUser } from "./request.js";
import { isAdminVerified } from "../lib/sessions.js";

/** Client IP: trust only loopback proxy X-Forwarded-For first hop, else socket. */
export function clientIp(req) {
  const remote = req.socket?.remoteAddress || "";
  const isLoopback =
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1";
  if (isLoopback) {
    const xff = req.get("x-forwarded-for");
    if (xff) {
      const first = String(xff).split(",")[0].trim();
      if (first) return first.replace(/^::ffff:/, "");
    }
  }
  return String(remote).replace(/^::ffff:/, "");
}

/**
 * Gate: admin API must be enabled; optional IP allowlist.
 * When disabled, respond 404 so the surface is not advertised.
 */
export function requireAdminGate(req, res, next) {
  if (!config.adminEnabled) {
    return fail(res, 404, "NOT_FOUND", "接口不存在");
  }
  if (config.adminIpAllowlist.length) {
    const ip = clientIp(req);
    if (!config.adminIpAllowlist.includes(ip)) {
      return fail(res, 404, "NOT_FOUND", "接口不存在");
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== "admin") {
      return fail(res, 403, "FORBIDDEN", "需要管理员权限");
    }
    next();
  });
}

export function requireAdminVerified(req, res, next) {
  if (!isAdminVerified(req.session)) {
    return fail(res, 403, "ADMIN_REAUTH_REQUIRED", "请先二次验证管理员密码");
  }
  next();
}
