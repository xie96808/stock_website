-- Intraday sessions live outside game_sessions: minute tapes do not fit fill_mode / game_days.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS intraday_tapes (
  id TEXT PRIMARY KEY,
  pack_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  session_date TEXT NOT NULL,
  prev_close_fen INTEGER NOT NULL,
  limit_pct INTEGER NOT NULL CHECK (limit_pct IN (10, 20)),
  bar_count INTEGER NOT NULL CHECK (bar_count = 241),
  bars_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (symbol, session_date)
);

CREATE TABLE IF NOT EXISTS intraday_challenges (
  id TEXT PRIMARY KEY,
  challenge_date TEXT NOT NULL UNIQUE,
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  flat_phase_starts_at TEXT NOT NULL,
  long_phase_starts_at TEXT NOT NULL,
  tape_id TEXT NOT NULL REFERENCES intraday_tapes(id),
  score_version TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intraday_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  create_key TEXT NOT NULL,
  create_payload_hash TEXT NOT NULL,
  game_kind TEXT NOT NULL DEFAULT 'intraday' CHECK (game_kind = 'intraday'),
  protocol_version TEXT NOT NULL DEFAULT 'intraday-v1' CHECK (protocol_version = 'intraday-v1'),
  score_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ranked', 'practice')),
  start_mode TEXT NOT NULL CHECK (start_mode IN ('flat', 'long')),
  challenge_id TEXT REFERENCES intraday_challenges(id),
  tape_id TEXT NOT NULL REFERENCES intraday_tapes(id),
  cursor INTEGER NOT NULL DEFAULT -1,
  revision INTEGER NOT NULL DEFAULT 0,
  canonical_actions_json TEXT NOT NULL DEFAULT '[]',
  clock_origin_ms INTEGER,
  paused_at_ms INTEGER,
  bar_interval_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'abandoned', 'expired')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (user_id, create_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intraday_one_active
  ON intraday_sessions(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS intraday_attempts (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES intraday_challenges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_mode TEXT NOT NULL CHECK (start_mode IN ('flat', 'long')),
  session_id TEXT NOT NULL UNIQUE REFERENCES intraday_sessions(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'abandoned', 'expired', 'settle_late')),
  board_eligible INTEGER NOT NULL DEFAULT 0 CHECK (board_eligible IN (0, 1)),
  return_ppm INTEGER,
  trade_count INTEGER,
  fee_drag_ppm INTEGER,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, challenge_id, start_mode)
);

CREATE INDEX IF NOT EXISTS idx_intraday_attempts_board
  ON intraday_attempts(challenge_id, start_mode, board_eligible, return_ppm DESC, trade_count ASC);

CREATE TABLE IF NOT EXISTS intraday_results (
  session_id TEXT PRIMARY KEY REFERENCES intraday_sessions(id),
  submission_hash TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  trades_json TEXT NOT NULL,
  return_ppm INTEGER NOT NULL,
  fee_drag_ppm INTEGER NOT NULL,
  trade_count INTEGER NOT NULL,
  liquidation INTEGER NOT NULL CHECK (liquidation IN (0, 1)),
  end_position TEXT NOT NULL CHECK (end_position = 'empty'),
  score_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intraday_commands (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES intraday_sessions(id),
  command_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prefetch', 'act', 'finish', 'abandon')),
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  event_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, command_key),
  UNIQUE (session_id, revision_after)
);

CREATE TABLE IF NOT EXISTS intraday_import_state (
  path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
