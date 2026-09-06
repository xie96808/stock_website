import crypto from "node:crypto";

const isProd = process.env.NODE_ENV === "production";

function requireSecret(name, fallbackDev) {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (isProd) throw new Error(`${name} required in production`);
  return fallbackDev;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  isProd,
  cookieName: process.env.SESSION_COOKIE_NAME || (isProd ? "__Host-stockgame_session" : "stockgame_session"),
  cookieSecure: process.env.COOKIE_SECURE === "1" || isProd,
  csrfSecret: requireSecret("CSRF_SECRET", "dev-csrf-secret-change-me-32b"),
  originAllowlist: (process.env.ORIGIN_ALLOWLIST || "http://127.0.0.1:8787,http://localhost:8787")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  sessionIdleMs: 7 * 24 * 60 * 60 * 1000,
  sessionAbsoluteMs: 30 * 24 * 60 * 60 * 1000,
  staticRoot: process.env.STATIC_ROOT || "",
};

export function newRequestId() {
  return crypto.randomUUID();
}
