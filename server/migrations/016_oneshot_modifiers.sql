-- Phase A: extend game_kind CHECK with oneshot/survival; add modifiers TEXT JSON.
-- Runner temporarily disables foreign_keys (see migrate.js) so the table rebuild
-- can drop/rename while child FKs (game_results, game_commands, daily attempts) stay.
-- survival is in CHECK only (Phase B); do not create survival sessions here.

CREATE TABLE game_sessions_oneshot_mig (
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
  game_kind TEXT NOT NULL DEFAULT 'classic'
    CHECK (game_kind IN ('classic', 'daily', 'archive_practice', 'puzzle', 'oneshot', 'survival')),
  protocol_version TEXT NOT NULL DEFAULT 'legacy-batch'
    CHECK (protocol_version IN ('legacy-batch', 'event-v1')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  undo_count INTEGER NOT NULL DEFAULT 0 CHECK (undo_count IN (0, 1)),
  assist_class TEXT NOT NULL DEFAULT 'legacy'
    CHECK (assist_class IN ('legacy', 'clean', 'undo')),
  challenge_id TEXT,
  puzzle_version_id TEXT,
  initial_state_json TEXT,
  canonical_actions_json TEXT,
  economy_version TEXT,
  modifiers TEXT,
  UNIQUE (user_id, create_key)
);

INSERT INTO game_sessions_oneshot_mig (
  id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
  fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
  game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
  finished_at, game_kind, protocol_version, revision, undo_count, assist_class,
  challenge_id, puzzle_version_id, initial_state_json, canonical_actions_json,
  economy_version, modifiers
)
SELECT
  id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
  fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
  game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
  finished_at, game_kind, protocol_version, revision, undo_count, assist_class,
  challenge_id, puzzle_version_id, initial_state_json, canonical_actions_json,
  economy_version, NULL
FROM game_sessions;

DROP TABLE game_sessions;
ALTER TABLE game_sessions_oneshot_mig RENAME TO game_sessions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_one_active
  ON game_sessions(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_status_finished
  ON game_sessions(user_id, status, finished_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_game_sessions_expires
  ON game_sessions(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_game_sessions_leaderboard_board
  ON game_sessions(rule_version, dataset_version, fill_mode, status, finished_at, id);

CREATE INDEX IF NOT EXISTS idx_game_sessions_kind_protocol
  ON game_sessions(game_kind, protocol_version, status);
