-- Stage 3: datasets + game_sessions + game_results
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS datasets (
  version TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  stock_count INTEGER NOT NULL,
  date_min TEXT,
  date_max TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  create_key TEXT NOT NULL,
  create_payload_hash TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL REFERENCES datasets(version),
  fill_mode TEXT NOT NULL CHECK (fill_mode IN ('next_open', 'same_close')),
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  stock_index INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  history_length INTEGER NOT NULL,
  game_days INTEGER NOT NULL DEFAULT 30,
  snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'abandoned', 'expired')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (user_id, create_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_one_active
  ON game_sessions(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_status_finished
  ON game_sessions(user_id, status, finished_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_game_sessions_expires
  ON game_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS game_results (
  game_id TEXT PRIMARY KEY REFERENCES game_sessions(id),
  submission_hash TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  trades_json TEXT NOT NULL,
  return_ppm INTEGER NOT NULL,
  equity_multiple_decimal TEXT NOT NULL,
  trade_count INTEGER NOT NULL,
  valuation_json TEXT,
  validity TEXT NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'invalid')),
  leaderboard_hidden INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_hidden IN (0, 1)),
  moderation_reason TEXT,
  moderated_by INTEGER REFERENCES users(id),
  moderated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_results_ppm
  ON game_results(validity, leaderboard_hidden, return_ppm DESC, game_id);
