-- 032: 成就 (additive only: one table + one partial unique ledger index).
-- Progress is always derived from live data (games, streak, quiz, pvp, invites…), so existing players get credit
-- for what they already did. A row here means "claimed": coins were paid once and any unlock became theirs.
-- Coins go through jiu_coin_ledger (reason 'achievement_claim', ref_id '<userId>:<key>').
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK (coins >= 0),
  unlock_key TEXT,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_achievement_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'achievement_claim';
