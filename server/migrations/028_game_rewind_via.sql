-- 028: how a rewind was paid (Track R2). Additive only: one nullable column + partial index.
-- NULL (all existing rows, and every coin rewind) = coin / no rewind; 'ticket' = paid with a 后悔券.
-- Audit fact only: no leaderboard / stats query reads it (assist_class stays the single board source).
ALTER TABLE game_sessions ADD COLUMN rewind_via TEXT CHECK (rewind_via IS NULL OR rewind_via = 'ticket');
CREATE INDEX IF NOT EXISTS idx_game_sessions_rewind_via ON game_sessions(rewind_via, finished_at) WHERE rewind_via IS NOT NULL;
