import { openDb } from "../db/connection.js";

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username_normalized,
    nickname: row.nickname,
    avatarId: row.avatar_id,
    role: row.role,
    status: row.status,
    leaderboardOptIn: !!row.leaderboard_opt_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export function insertUser({ username, passwordHash, nickname, avatarId, leaderboardOptIn, recoveryCodeHash }) {
  const info = openDb()
    .prepare(`INSERT INTO users (
      username_normalized, password_hash, nickname, avatar_id,
      leaderboard_opt_in, recovery_code_hash
    ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(username, passwordHash, nickname, avatarId, leaderboardOptIn ? 1 : 0, recoveryCodeHash);
  return findUserById(info.lastInsertRowid);
}

export function updateUserProfile(id, { nickname, avatarId, leaderboardOptIn }) {
  const row = findUserById(id);
  if (!row || row.status === "deleted") return null;
  const nn = nickname != null ? nickname : row.nickname;
  const av = avatarId != null ? avatarId : row.avatar_id;
  const opt = leaderboardOptIn != null ? (leaderboardOptIn ? 1 : 0) : row.leaderboard_opt_in;
  openDb().prepare(`UPDATE users SET nickname = ?, avatar_id = ?, leaderboard_opt_in = ?,
    updated_at = datetime('now') WHERE id = ?`).run(nn, av, opt, id);
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

export function softDeleteUser(id) {
  openDb()
    .prepare(`UPDATE users SET status = 'deleted', deleted_at = datetime('now'),
      updated_at = datetime('now'), password_hash = '!', recovery_code_hash = NULL WHERE id = ?`)
    .run(id);
}
