import { openDb } from "../db/connection.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";
import { runUserUnavailableHook, writeUserTombstone } from "./tombstones.js";
import { grantRegisterBonus } from "./jiuCoin.js";
import { frameProp } from "./frameProp.js";
import { entranceProp } from "./cosmeticProp.js";

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
    ...entranceProp(row.pvp_entrance),
    role: row.role,
    status: row.status,
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
