-- 030: 连续登录奖励 (additive only: two new tables + one partial unique index, nothing altered).
--   login_streaks        one row per user: where they are in the 7-day cycle.
--   login_streak_claims  one row per user per Asia/Shanghai day claimed (idempotency + audit of what was paid).
-- Coins go through jiu_coin_ledger (reason 'streak_claim', ref_id '<userId>:<YYYY-MM-DD>'); the day-7 bonus spin is
-- a lucky_wheel_credit_grants row (source_key 'streak:<userId>:<YYYY-MM-DD>').
CREATE TABLE IF NOT EXISTS login_streaks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  cycle_pos INTEGER NOT NULL DEFAULT 0 CHECK (cycle_pos BETWEEN 0 AND 7),
  run_days INTEGER NOT NULL DEFAULT 0 CHECK (run_days >= 0),
  best_run INTEGER NOT NULL DEFAULT 0 CHECK (best_run >= 0),
  cycles_done INTEGER NOT NULL DEFAULT 0 CHECK (cycles_done >= 0),
  total_claims INTEGER NOT NULL DEFAULT 0 CHECK (total_claims >= 0),
  last_claim_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_streak_claims (
  user_id INTEGER NOT NULL REFERENCES users(id),
  claim_date TEXT NOT NULL,
  cycle_pos INTEGER NOT NULL CHECK (cycle_pos BETWEEN 1 AND 7),
  run_days INTEGER NOT NULL CHECK (run_days >= 1),
  coins INTEGER NOT NULL CHECK (coins >= 0),
  bonus_spins INTEGER NOT NULL DEFAULT 0 CHECK (bonus_spins >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, claim_date)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_streak_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'streak_claim';
