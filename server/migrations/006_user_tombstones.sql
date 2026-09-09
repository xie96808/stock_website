-- Phase 0: soft-delete tombstones for backup restore replay
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username_normalized TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('self', 'admin')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_tombstones_user_id
  ON user_tombstones(user_id);

CREATE INDEX IF NOT EXISTS idx_user_tombstones_active
  ON user_tombstones(user_id, reversed_at);

CREATE INDEX IF NOT EXISTS idx_user_tombstones_username
  ON user_tombstones(username_normalized);
