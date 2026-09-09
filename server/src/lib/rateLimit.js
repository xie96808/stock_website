/**
 * In-memory rate limiter for single-process API.
 * Process restart resets counters — not sole abuse control.
 */

import { config } from "./config.js";

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

let lastPrune = Date.now();

function pruneIfNeeded() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {{ ok: true, remaining: number, resetAt: number } | { ok: false, retryAfterSec: number, remaining: 0, resetAt: number }}
 */
export function consumeRateLimit(key, limit, windowMs) {
  pruneIfNeeded();
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  if (entry.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { ok: false, retryAfterSec, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/** Peek without consuming. */
export function peekRateLimit(key, limit, windowMs) {
  pruneIfNeeded();
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    return { ok: true, remaining: limit, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { ok: false, retryAfterSec, remaining: 0, resetAt: entry.resetAt };
  }
  return {
    ok: true,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/** Test helper — clear all buckets. */
export function resetRateLimitBuckets() {
  buckets.clear();
  lastPrune = Date.now();
}

/**
 * Client IP for rate limits. Prefer X-Forwarded-For only when peer is loopback
 * (nginx on same host). Do not trust forwarded headers from the open internet.
 */
export function clientIp(req) {
  const remote = req.socket?.remoteAddress || req.ip || "";
  const normalized = String(remote).replace(/^::ffff:/, "");
  const isLoopback =
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost";
  if (isLoopback) {
    const xff = req.get?.("x-forwarded-for") || req.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const first = xff.split(",")[0].trim().replace(/^::ffff:/, "");
      if (first) return first;
    }
  }
  return normalized || "unknown";
}

export function rateLimitFail(res, retryAfterSec, message) {
  const sec = Math.max(1, Number(retryAfterSec) || 60);
  res.setHeader("Retry-After", String(sec));
  const requestId = res.locals.requestId;
  return res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: message || "请求过于频繁，请稍后再试",
      retryAfterSec: sec,
    },
    requestId,
  });
}

/** Login: peek whether already limited (no consume). */
export function checkLoginFailLimits(username, ip) {
  const u = (username || "").toLowerCase() || "_";
  const cfg = config.rateLimit;
  const accountIp = peekRateLimit(
    `login:acct:${u}:${ip}`,
    cfg.loginFailPerAccountIp,
    cfg.loginFailWindowMs
  );
  if (!accountIp.ok) {
    return {
      limited: true,
      retryAfterSec: accountIp.retryAfterSec,
      message: "登录失败次数过多，请稍后再试",
    };
  }
  const ipOnly = peekRateLimit(
    `login:ip:${ip}`,
    cfg.loginFailPerIp,
    cfg.loginFailWindowMs
  );
  if (!ipOnly.ok) {
    return {
      limited: true,
      retryAfterSec: ipOnly.retryAfterSec,
      message: "来自此网络的登录尝试过于频繁，请稍后再试",
    };
  }
  return { limited: false };
}

/** Record a failed login against account+IP and IP buckets. */
export function recordLoginFailure(username, ip) {
  const u = (username || "").toLowerCase() || "_";
  const cfg = config.rateLimit;
  consumeRateLimit(
    `login:acct:${u}:${ip}`,
    cfg.loginFailPerAccountIp,
    cfg.loginFailWindowMs
  );
  consumeRateLimit(
    `login:ip:${ip}`,
    cfg.loginFailPerIp,
    cfg.loginFailWindowMs
  );
}

/** Register: per IP hour + day. Called before creating user. */
export function checkRegisterLimits(ip) {
  const cfg = config.rateLimit;
  const hour = consumeRateLimit(`reg:h:${ip}`, cfg.registerPerIpHour, cfg.registerHourMs);
  if (!hour.ok) {
    return {
      limited: true,
      retryAfterSec: hour.retryAfterSec,
      message: "注册过于频繁，请稍后再试（同一网络每小时有上限）",
    };
  }
  const day = consumeRateLimit(`reg:d:${ip}`, cfg.registerPerIpDay, cfg.registerDayMs);
  if (!day.ok) {
    return {
      limited: true,
      retryAfterSec: day.retryAfterSec,
      message: "今日注册次数已达上限，请明天再试（共享网络可能误伤）",
    };
  }
  return { limited: false };
}

/** Create-game: per user minute + day. */
export function checkCreateGameLimits(userId) {
  const cfg = config.rateLimit;
  const uid = String(userId);
  const minute = consumeRateLimit(
    `game:m:${uid}`,
    cfg.createGamePerUserMinute,
    cfg.createGameMinuteMs
  );
  if (!minute.ok) {
    return {
      limited: true,
      retryAfterSec: minute.retryAfterSec,
      message: "开局过于频繁，请稍后再试",
    };
  }
  const day = consumeRateLimit(
    `game:d:${uid}`,
    cfg.createGamePerUserDay,
    cfg.createGameDayMs
  );
  if (!day.ok) {
    return {
      limited: true,
      retryAfterSec: day.retryAfterSec,
      message: "今日开局次数已达上限，请明天再试",
    };
  }
  return { limited: false };
}
