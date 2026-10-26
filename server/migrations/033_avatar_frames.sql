-- 033: 头像框 (additive only: one nullable column, one table, one partial unique ledger index).
--   users.avatar_frame  the equipped frame id (NULL = none). Validated against the code-side list on every read.
--   user_frames         frames bought in the shop. Frames earned through 成就 are NOT copied here: ownership is
--                       shop rows ∪ user_achievements.unlock_key, so there is a single source of truth for each.
-- Coins go through jiu_coin_ledger (reason 'frame_purchase', negative delta, ref_id '<userId>:<frameId>').
ALTER TABLE users ADD COLUMN avatar_frame TEXT;

CREATE TABLE IF NOT EXISTS user_frames (
  user_id INTEGER NOT NULL REFERENCES users(id),
  frame_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, frame_id)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_frame_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'frame_purchase';
