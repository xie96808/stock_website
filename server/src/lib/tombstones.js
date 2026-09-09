/**
 * Soft-delete tombstones: survive backup restore so deleted accounts stay deleted.
 * Full DB restore remains CLI/server only — never a web admin button.
 */
import { openDb } from "../db/connection.js";
import { revokeAllUserSessions } from "./sessions.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";

export function writeUserTombstone({
  userId,
  usernameNormalized,
  source,
  reason = null,
}) {
  if (!userId || !usernameNormalized || (source !== "self" && source !== "admin")) {
    throw new Error("tombstone requires userId, usernameNormalized, source");
  }
  const info = openDb()
    .prepare(
      `INSERT INTO user_tombstones (user_id, username_normalized, source, reason)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      userId,
      String(usernameNormalized).toLowerCase(),
      source,
      reason != null ? String(reason) : null
    );
  return info.lastInsertRowid;
}

export function reverseActiveTombstonesForUser(userId) {
  openDb()
    .prepare(
      `UPDATE user_tombstones SET reversed_at = datetime('now')
       WHERE user_id = ? AND reversed_at IS NULL`
    )
    .run(userId);
}

export function listActiveTombstones() {
  return openDb()
    .prepare(
      `SELECT id, user_id, username_normalized, source, reason, created_at
       FROM user_tombstones
       WHERE reversed_at IS NULL
       ORDER BY id ASC`
    )
    .all();
}

/**
 * Apply active tombstones to the current DB (e.g. after restore from backup).
 * Soft-deletes matching users (by user_id, else username), revokes sessions.
 * Does not wipe credentials again if already deleted.
 * @returns {{ applied: number, alreadyDeleted: number, missing: number }}
 */
export function replayUserTombstones() {
  const db = openDb();
  const rows = listActiveTombstones();
  let applied = 0;
  let alreadyDeleted = 0;
  let missing = 0;

  const tx = db.transaction(() => {
    for (const t of rows) {
      let user = db.prepare("SELECT * FROM users WHERE id = ?").get(t.user_id);
      if (!user) {
        user = db
          .prepare("SELECT * FROM users WHERE username_normalized = ?")
          .get(t.username_normalized);
      }
      if (!user) {
        missing += 1;
        continue;
      }
      if (user.status === "deleted") {
        alreadyDeleted += 1;
        continue;
      }
      db.prepare(
        `UPDATE users SET status = 'deleted', deleted_at = datetime('now'),
          updated_at = datetime('now'), password_hash = '!', recovery_code_hash = NULL
         WHERE id = ?`
      ).run(user.id);
      revokeAllUserSessions(user.id);
      applied += 1;
    }
  });
  tx();
  if (applied > 0) invalidateLeaderboardCache();
  return { applied, alreadyDeleted, missing, total: rows.length };
}
