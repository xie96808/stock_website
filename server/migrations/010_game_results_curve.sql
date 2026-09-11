-- B0-PR2: settle metrics on game_results (nullable for legacy rows).
-- mdd_ppm / benchmark_return_ppm / equity_curve_json filled only for event-v1 settle.
PRAGMA foreign_keys = ON;

ALTER TABLE game_results ADD COLUMN mdd_ppm INTEGER;
ALTER TABLE game_results ADD COLUMN benchmark_return_ppm INTEGER;
ALTER TABLE game_results ADD COLUMN equity_curve_json TEXT;
ALTER TABLE game_results ADD COLUMN score_version TEXT;
ALTER TABLE game_results ADD COLUMN assist_class TEXT
  CHECK (assist_class IS NULL OR assist_class IN ('legacy', 'clean', 'undo'));
