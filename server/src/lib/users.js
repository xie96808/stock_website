import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { medalProp } from "./coinBoard.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";
import { runUserUnavailableHook, writeUserTombstone } from "./tombstones.js";
import { grantRegisterBonus, grantGuestBonus } from "./jiuCoin.js";
import { frameProp } from "./frameProp.js";
import { entranceProp } from "./cosmeticProp.js";
import { titlePropFromRaw } from "./titleProp.js";
import { renameCardEnabled } from "./renameCards.js";

export function publicUser(row) {
  if (!row) return null;
  const custom = row.avatar_custom_path || null;
  return {
    id: row.id,
    username: row.username_normalized,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    avatarUrl: custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null,
    ...frameProp(row.avatar_frame),
    ...medalProp(row.id),
    ...entranceProp(row.pvp_entrance),
    ...titlePropFromRaw(row.title),
    ...(renameCardEnabled() ? { renameCards: Number(row.rename_cards) || 0 } : {}),
    role: row.role,
    status: row.status,
    isGuest: !!row.is_guest,
    leaderboardOptIn: !!row.leaderboard_opt_in,
    signature: row.signature == null ? "" : String(row.signature),
    jiuCoinBalance: Number(row.jiu_coin_balance) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}

export function findUserByUsername(username) {
  return openDb()
    .prepare("SELECT * FROM users WHERE username_normalized = ? AND status != 'deleted'")
    .get(username);
}

export function findUserById(id) {
  return openDb().prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function insertUser({ username, passwordHash, nickname, avatarId, leaderboardOptIn, recoveryCodeHash = null }) {
  const db = openDb();
  const tx = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO users (
        username_normalized, password_hash, nickname, avatar_id,
        leaderboard_opt_in, recovery_code_hash, jiu_coin_balance
      ) VALUES (?, ?, ?, ?, ?, ?, 0)`)
      .run(username, passwordHash, nickname, avatarId, leaderboardOptIn ? 1 : 0, recoveryCodeHash);
    const id = info.lastInsertRowid;
    grantRegisterBonus(id, db);
    return id;
  });
  const id = tx();
  return findUserById(id);
}

/** A guest's username can never be typed by a person: normalizeUsername only accepts [a-z][a-z0-9_]{3,23}. */
const GUEST_USERNAME_PREFIX = "~g~";

/** 游客先玩: a guest may open at most this many games in total (settled, abandoned and expired ones all count). */
export const GUEST_MAX_GAMES = 1;

/** Free games a guest still has (0 once the one game was opened, whatever became of it). */
export function guestGamesLeft(id) {
  const used = openDb().prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE user_id = ?").get(id).n;
  return Math.max(0, GUEST_MAX_GAMES - used);
}

/** publicUser(row) plus, for a guest only, how many free games it has left (the client routes on it). */
export function withGuestFields(user) {
  if (!user || !user.isGuest) return user;
  return { ...user, guestGamesLeft: guestGamesLeft(user.id) };
}

export function isGuestUser(id) {
  const row = openDb().prepare("SELECT is_guest FROM users WHERE id = ?").get(id);
  return !!(row && Number(row.is_guest) === 1);
}

/**
 * 游客先玩: create the temporary account (placeholder username, unusable password hash, not on the leaderboard)
 * and its start grant in one transaction.
 */
export function insertGuest({ nickname, avatarId }) {
  const db = openDb();
  const username = GUEST_USERNAME_PREFIX + crypto.randomBytes(8).toString("hex");
  const tx = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO users (
        username_normalized, password_hash, nickname, avatar_id,
        leaderboard_opt_in, recovery_code_hash, jiu_coin_balance, is_guest, last_active_at
      ) VALUES (?, '!', ?, ?, 0, NULL, 0, 1, datetime('now'))`)
      .run(username, nickname, avatarId);
    const id = info.lastInsertRowid;
    grantGuestBonus(id, db);
    return id;
  });
  return findUserById(tx());
}

/**
 * 游客先玩: registering while holding a guest session upgrades that same row, so its games, ledger and
 * history stay attached. The remaining guest coins are kept; the register grant is added on top.
 * @returns the upgraded row, or null when the row is no longer a guest (lost a race / already upgraded).
 * Throws on a UNIQUE username clash; the transaction rolls back and the account stays a guest.
 */
export function upgradeGuestToUser(id, { username, passwordHash, nickname, avatarId, leaderboardOptIn }) {
  const db = openDb();
  const tx = db.transaction(() => {
    const info = db
      .prepare(`UPDATE users SET username_normalized = ?, password_hash = ?, nickname = ?, avatar_id = ?,
        leaderboard_opt_in = ?, is_guest = 0, updated_at = datetime('now')
        WHERE id = ? AND is_guest = 1 AND status = 'active'`)
      .run(username, passwordHash, nickname, avatarId, leaderboardOptIn ? 1 : 0, id);
    if (info.changes !== 1) return false;
    grantRegisterBonus(id, db);
    return true;
  });
  if (!tx()) return null;
  // The game(s) the guest already played now belong to an opted-in player.
  invalidateLeaderboardCache();
  return findUserById(id);
}

/** Child rows a guest can own, deleted before the user row (foreign_keys = ON). Order matters. */
function purgeOneGuest(db, id) {
  const gameIds = db.prepare("SELECT id FROM game_sessions WHERE user_id = ?").all(id).map((r) => r.id);
  for (const gid of gameIds) {
    db.prepare("DELETE FROM game_commands WHERE game_id = ?").run(gid);
    db.prepare("DELETE FROM game_results WHERE game_id = ?").run(gid);
  }
  db.prepare("DELETE FROM game_sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM jiu_coin_ledger WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  const info = db.prepare("DELETE FROM users WHERE id = ? AND is_guest = 1").run(id);
  return info.changes === 1;
}

/**
 * Hard-delete guests that never registered. A guest is purgeable when it has been idle longer than `maxIdleMs`
 * (last_active_at, falling back to created_at) and has no still-running game (an expired 'active' row does not count). `ids` limits the sweep to given guests
 * and drops the idle test (used when a guest logs in to an existing account and their data is discarded).
 * A guest whose rows hit a foreign key we did not anticipate is skipped, not fatal.
 * @returns {{purged:number, skipped:number}}
 */
export function purgeGuestUsers({ maxIdleMs, ids = null, now = Date.now(), db = openDb() } = {}) {
  let candidates;
  if (Array.isArray(ids)) {
    candidates = ids
      .map((id) => db.prepare("SELECT id FROM users WHERE id = ? AND is_guest = 1").get(id))
      .filter(Boolean);
  } else {
    const cutoff = new Date(now - maxIdleMs).toISOString().slice(0, 19).replace("T", " ");
    candidates = db
      .prepare(
        `SELECT u.id FROM users u
         WHERE u.is_guest = 1 AND COALESCE(u.last_active_at, u.created_at) < ?
           AND NOT EXISTS (
             SELECT 1 FROM game_sessions g WHERE g.user_id = u.id AND g.status = 'active' AND g.expires_at > ?
           )`
      )
      .all(cutoff, new Date(now).toISOString());
  }
  let purged = 0;
  let skipped = 0;
  for (const { id } of candidates) {
    try {
      if (db.transaction(() => purgeOneGuest(db, id))()) purged += 1;
    } catch (e) {
      skipped += 1;
      console.error("[guest] purge skipped", id, e && e.message ? e.message : e);
    }
  }
  return { purged, skipped };
}

export function updateUserProfile(id, { nickname, avatarId, leaderboardOptIn, signature }) {
  const row = findUserById(id);
  if (!row || row.status === "deleted") return null;
  const nn = nickname != null ? nickname : row.nickname;
  const av = avatarId != null ? avatarId : row.avatar_id;
  const opt = leaderboardOptIn != null ? (leaderboardOptIn ? 1 : 0) : row.leaderboard_opt_in;
  const optChanged = leaderboardOptIn != null && opt !== row.leaderboard_opt_in;
  const sig = signature != null ? signature : (row.signature == null ? "" : row.signature);
  const nickOrAvatarChanged =
    (nickname != null && nickname !== row.nickname) ||
    (avatarId != null && avatarId !== row.avatar_id);
  openDb().prepare(`UPDATE users SET nickname = ?, avatar_id = ?, leaderboard_opt_in = ?, signature = ?,
    updated_at = datetime('now') WHERE id = ?`).run(nn, av, opt, sig, id);
  // Opt-in flips membership; nickname/avatar refresh public Top N display.
  if (optChanged || nickOrAvatarChanged) invalidateLeaderboardCache();
  return findUserById(id);
}

export function updateAvatarCustomPath(id, filename) {
  openDb()
    .prepare(`UPDATE users SET avatar_custom_path = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(filename, id);
  invalidateLeaderboardCache();
  return findUserById(id);
}

export function updatePassword(id, passwordHash) {
  openDb()
    .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(passwordHash, id);
}

export function updateRecoveryHash(id, recoveryCodeHash) {
  openDb()
    .prepare(`UPDATE users SET recovery_code_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(recoveryCodeHash, id);
}

/**
 * Soft-delete a user and write a tombstone.
 * @param {number} id
 * @param {{ wipeCredentials?: boolean, source?: 'self'|'admin', reason?: string|null }} [opts]
 *   - wipeCredentials: true for self-delete (default true). Admin soft-delete keeps hash for restore.
 */
export function softDeleteUser(id, opts = {}) {
  const wipeCredentials = opts.wipeCredentials !== false;
  const source = opts.source === "admin" ? "admin" : "self";
  const reason = opts.reason ?? null;
  const row = findUserById(id);
  if (!row || row.status === "deleted") return row;

  const db = openDb();
  const tx = db.transaction(() => {
    if (wipeCredentials) {
      db.prepare(
        `UPDATE users SET status = 'deleted', deleted_at = datetime('now'),
          updated_at = datetime('now'), password_hash = '!', recovery_code_hash = NULL WHERE id = ?`
      ).run(id);
    } else {
      db.prepare(
        `UPDATE users SET status = 'deleted', deleted_at = datetime('now'),
          updated_at = datetime('now') WHERE id = ?`
      ).run(id);
    }
    writeUserTombstone({
      userId: id,
      usernameNormalized: row.username_normalized,
      source,
      reason,
    });
    runUserUnavailableHook(db, id, Date.now());
  });
  tx();
  invalidateLeaderboardCache();
  return findUserById(id);
}
