-- F02 六关残局挑战首章: published level versions + per-user star progress.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS puzzle_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  level_index INTEGER NOT NULL CHECK (level_index >= 1 AND level_index <= 99),
  level_key TEXT NOT NULL,
  reward_family_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'preparing', 'stub')),
  rule_version TEXT NOT NULL,
  fill_mode TEXT NOT NULL DEFAULT 'next_open'
    CHECK (fill_mode IN ('next_open')),
  game_days INTEGER NOT NULL CHECK (game_days >= 6 AND game_days <= 10),
  max_orders INTEGER,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  stock_index INTEGER NOT NULL DEFAULT -1,
  window_start INTEGER NOT NULL DEFAULT -1,
  history_length INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  initial_state_json TEXT NOT NULL,
  goals_json TEXT NOT NULL,
  content_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, level_index, version),
  UNIQUE (level_key, version)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_versions_chapter_status
  ON puzzle_versions(chapter_id, status, level_index);

CREATE INDEX IF NOT EXISTS idx_puzzle_versions_family
  ON puzzle_versions(reward_family_id);

CREATE TABLE IF NOT EXISTS puzzle_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter_id TEXT NOT NULL,
  level_key TEXT NOT NULL,
  reward_family_id TEXT NOT NULL,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars >= 0 AND best_stars <= 3),
  best_return_ppm INTEGER,
  best_mdd_ppm INTEGER,
  best_order_count INTEGER,
  first_two_star_at TEXT,
  last_played_at TEXT,
  last_puzzle_version_id TEXT REFERENCES puzzle_versions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, level_key)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_progress_user_chapter
  ON puzzle_progress(user_id, chapter_id);
