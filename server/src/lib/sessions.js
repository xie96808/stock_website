import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { deriveCsrfToken, randomToken, sha256Hex } from "./crypto.js";

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function createSession(userId) {
  const sessionToken = randomToken(32);
  const csrfToken = deriveCsrfToken(sessionToken);
  const tokenHash = sha256Hex(sessionToken);
  const csrfHash = sha256Hex(csrfToken);
  const expiresAt = isoAfter(Math.min(config.sessionIdleMs, config.sessionAbsoluteMs));
  openDb()
    .prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token_hash, expires_at)
      VALUES (?, ?, ?, ?)`)
    .run(tokenHash, userId, csrfHash, expiresAt);
  return { sessionToken, csrfToken, expiresAt };
}

export function findValidSession(sessionToken) {
  if (!sessionToken) return null;
  const tokenHash = sha256Hex(sessionToken);
  const row = openDb()
    .prepare(`SELECT u.id AS id, u.username_normalized, u.nickname, u.avatar_id, u.role, u.status,
      u.leaderboard_opt_in, u.created_at, u.updated_at, u.password_hash, u.recovery_code_hash,
      s.token_hash, s.expires_at, s.last_seen_at, s.revoked_at, s.user_id
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`)
    .get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.status !== "active") return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  const last = Date.parse(row.last_seen_at);
  if (Date.now() - last > 5 * 60 * 1000) {
    const newExp = isoAfter(config.sessionIdleMs);
    openDb()
      .prepare("UPDATE sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE token_hash = ?")
      .run(newExp, tokenHash);
    row.expires_at = newExp;
  }
  return row;
}

export function revokeSessionToken(sessionToken) {
  if (!sessionToken) return;
  openDb()
    .prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL")
    .run(sha256Hex(sessionToken));
}

export function revokeAllUserSessions(userId) {
  openDb()
    .prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
    .run(userId);
}

export function setSessionCookie(res, sessionToken) {
  res.cookie(config.cookieName, sessionToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionAbsoluteMs,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
  });
}
