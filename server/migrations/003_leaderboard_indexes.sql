-- Stage 4: leaderboard query indexes (dual-mode boards)
PRAGMA foreign_keys = ON;

-- Board key + settled sessions for eligibility scan
CREATE INDEX IF NOT EXISTS idx_game_sessions_leaderboard_board
  ON game_sessions(rule_version, dataset_version, fill_mode, status, finished_at, id);

-- Join path: settled results eligible for ranking
CREATE INDEX IF NOT EXISTS idx_game_results_leaderboard_eligible
  ON game_results(validity, leaderboard_hidden, trade_count, return_ppm DESC, game_id);

-- Opt-in / role filter on users
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_opt_in
  ON users(leaderboard_opt_in, status, role) WHERE leaderboard_opt_in = 1 AND status = 'active';
