-- F01 daily same-question challenge: published snapshots + one official attempt per user/day.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS daily_challenges (
  id TEXT PRIMARY KEY,
  challenge_date TEXT NOT NULL UNIQUE,
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  fill_mode TEXT NOT NULL DEFAULT 'next_open'
    CHECK (fill_mode IN ('next_open')),
  initial_cash INTEGER NOT NULL DEFAULT 100000,
  rule_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  stock_index INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  history_length INTEGER NOT NULL,
  game_days INTEGER NOT NULL DEFAULT 30,
  snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  market_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_challenges_opens
  ON daily_challenges(opens_at, closes_at);

CREATE TABLE IF NOT EXISTS daily_challenge_attempts (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES daily_challenges(id),
  challenge_date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL UNIQUE REFERENCES game_sessions(id),
  status TEXT NOT NULL
    CHECK (status IN ('active', 'settled', 'abandoned', 'expired', 'settle_late')),
  board_eligible INTEGER NOT NULL DEFAULT 0 CHECK (board_eligible IN (0, 1)),
  return_ppm INTEGER,
  mdd_ppm INTEGER,
  benchmark_return_ppm INTEGER,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_attempts_board
  ON daily_challenge_attempts(challenge_id, board_eligible, return_ppm DESC, mdd_ppm ASC);

CREATE INDEX IF NOT EXISTS idx_daily_attempts_user_date
  ON daily_challenge_attempts(user_id, challenge_date);
