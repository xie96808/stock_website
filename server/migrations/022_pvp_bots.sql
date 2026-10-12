-- PvP companion bots: users.is_bot, widen pvp_actions.source, seed 3 bots.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot) WHERE is_bot = 1;

-- SQLite cannot ALTER CHECK; rebuild pvp_actions to allow source='bot'.
CREATE TABLE pvp_actions_bots_mig (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 29),
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  source TEXT NOT NULL CHECK (source IN ('player', 'timeout', 'bot')),
  command_key TEXT,
  payload_hash TEXT,
  locked_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id, round),
  FOREIGN KEY (match_id, user_id) REFERENCES pvp_match_players(match_id, user_id)
);

INSERT INTO pvp_actions_bots_mig (
  match_id, user_id, round, action, source, command_key, payload_hash, locked_at
)
SELECT match_id, user_id, round, action, source, command_key, payload_hash, locked_at
FROM pvp_actions;

DROP TABLE pvp_actions;
ALTER TABLE pvp_actions_bots_mig RENAME TO pvp_actions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_actions_command
  ON pvp_actions(match_id, user_id, command_key) WHERE command_key IS NOT NULL;

-- Fixed bot accounts: not loginable (password '!'; username starts with '_' so normalizeUsername rejects).
INSERT OR IGNORE INTO users (
  username_normalized, password_hash, nickname, avatar_id,
  role, status, leaderboard_opt_in, jiu_coin_balance, is_bot
) VALUES
  ('__pvp_bot_1', '!', '做T机器神', 2, 'user', 'active', 0, 10000000, 1),
  ('__pvp_bot_2', '!', '波段菠菜机', 7, 'user', 'active', 0, 10000000, 1),
  ('__pvp_bot_3', '!', '追涨小白条', 11, 'user', 'active', 0, 10000000, 1);
