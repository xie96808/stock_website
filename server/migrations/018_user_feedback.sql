-- User feedback to developer (text + optional images under STOCKGAME_DATA_DIR/feedback/)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS user_feedback_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES user_feedback(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (filename)
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_admin
  ON user_feedback(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_status
  ON user_feedback(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_user
  ON user_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_images_fid
  ON user_feedback_images(feedback_id, sort_order, id);
