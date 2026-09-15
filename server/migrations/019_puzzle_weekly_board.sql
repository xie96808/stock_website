-- Puzzle same-level weekly board: index settled puzzle finishes for week-window scans.
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_game_sessions_puzzle_settled_finished
  ON game_sessions(finished_at, puzzle_version_id)
  WHERE game_kind = 'puzzle' AND status = 'settled';
