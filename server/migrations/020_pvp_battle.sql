-- PvP battle tables. Epoch milliseconds. Does not alter classic game_sessions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pvp_challenges (
  id TEXT PRIMARY KEY,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  pair_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  create_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER,
  cancel_reason TEXT,
  CHECK (from_user_id <> to_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_challenges_create_key
  ON pvp_challenges(from_user_id, create_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_challenges_one_outbound
  ON pvp_challenges(from_user_id) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_challenges_one_pair
  ON pvp_challenges(pair_key) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pvp_challenges_inbox
  ON pvp_challenges(to_user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS pvp_matches (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES pvp_challenges(id),
  status TEXT NOT NULL CHECK (status IN ('waiting_ready', 'playing', 'settled', 'aborted')),
  rule_version TEXT NOT NULL,
  pvp_version TEXT NOT NULL,
  rating_version TEXT NOT NULL,
  dataset_version TEXT REFERENCES datasets(version),
  fill_mode TEXT NOT NULL DEFAULT 'next_open' CHECK (fill_mode = 'next_open'),
  snapshot_json TEXT,
  snapshot_sha256 TEXT,
  history_length INTEGER,
  economy_json TEXT,
  reward_ymd TEXT,
  resolved_rounds INTEGER NOT NULL DEFAULT 0 CHECK (resolved_rounds BETWEEN 0 AND 29),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  round_opens_at INTEGER,
  round_deadline_at INTEGER,
  ready_deadline_at INTEGER,
  boot_id TEXT,
  winner_user_id INTEGER REFERENCES users(id),
  terminal_reason TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  CHECK (
    status IN ('waiting_ready', 'aborted')
    OR (
      snapshot_json IS NOT NULL
      AND dataset_version IS NOT NULL
      AND started_at IS NOT NULL
      AND economy_json IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_due
  ON pvp_matches(status, round_deadline_at);

CREATE TABLE IF NOT EXISTS pvp_match_players (
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  seat INTEGER NOT NULL CHECK (seat IN (1, 2)),
  ready_at INTEGER,
  afk_streak INTEGER NOT NULL DEFAULT 0 CHECK (afk_streak >= 0),
  outcome TEXT CHECK (outcome IN ('win', 'loss', 'draw', 'aborted')),
  return_ppm INTEGER,
  mdd_ppm INTEGER,
  partial_return_ppm INTEGER,
  trade_count INTEGER,
  valuation_json TEXT,
  rating_before INTEGER,
  rating_after INTEGER,
  actual_rating_delta INTEGER,
  coin_delta INTEGER,
  actions_json TEXT NOT NULL DEFAULT '[]',
  analysis_version TEXT,
  analysis_json TEXT,
  analysis_status TEXT CHECK (analysis_status IN ('pending', 'ready', 'failed')),
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_players_user
  ON pvp_match_players(user_id, match_id);

CREATE TABLE IF NOT EXISTS pvp_active_members (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  match_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  FOREIGN KEY (match_id, user_id) REFERENCES pvp_match_players(match_id, user_id)
);

CREATE TABLE IF NOT EXISTS pvp_actions (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 29),
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  source TEXT NOT NULL CHECK (source IN ('player', 'timeout')),
  command_key TEXT,
  payload_hash TEXT,
  locked_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id, round),
  FOREIGN KEY (match_id, user_id) REFERENCES pvp_match_players(match_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_actions_command
  ON pvp_actions(match_id, user_id, command_key) WHERE command_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pvp_rounds (
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 29),
  resolved_at INTEGER NOT NULL,
  revealed_day INTEGER NOT NULL,
  both_players_state_json TEXT NOT NULL,
  PRIMARY KEY (match_id, round)
);

CREATE TABLE IF NOT EXISTS pvp_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL UNIQUE REFERENCES pvp_matches(id),
  terminal_type TEXT NOT NULL CHECK (terminal_type IN ('completed', 'forfeited', 'aborted')),
  reason TEXT NOT NULL,
  winner_user_id INTEGER REFERENCES users(id),
  resolved_rounds INTEGER NOT NULL,
  economy_version TEXT,
  rating_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_settlements_created
  ON pvp_settlements(created_at, id);

CREATE TABLE IF NOT EXISTS pvp_commands (
  user_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resource_id TEXT,
  ack_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope, key)
);

CREATE TABLE IF NOT EXISTS pvp_ratings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  rating INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  completed_games INTEGER NOT NULL DEFAULT 0,
  completed_return_sum_ppm INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pvp_reward_days (
  user_id INTEGER NOT NULL REFERENCES users(id),
  ymd TEXT NOT NULL,
  win_reward_count INTEGER NOT NULL DEFAULT 0 CHECK (win_reward_count >= 0),
  PRIMARY KEY (user_id, ymd)
);

CREATE TABLE IF NOT EXISTS pvp_blocks (
  blocker_user_id INTEGER NOT NULL REFERENCES users(id),
  blocked_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE IF NOT EXISTS pvp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES pvp_matches(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reported_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('cheat', 'grief_forfeit', 'nickname', 'other')),
  detail TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  UNIQUE (match_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_pvp_reports_status
  ON pvp_reports(status, created_at);

CREATE TABLE IF NOT EXISTS pvp_runtime_control (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_pvp_once
  ON jiu_coin_ledger(user_id, ref_id, reason)
  WHERE ref_type = 'pvp_match'
    AND reason IN ('pvp_entry', 'pvp_reward', 'pvp_refund');
