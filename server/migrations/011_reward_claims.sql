-- B0-PR3 / B05: idempotent reward_claims (PRD §6.3). Additive only; unused by user-facing paths yet.
-- Unique (user_id, reward_key); ledger_id links to jiu_coin_ledger for reconciliation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reward_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reward_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  economy_version TEXT NOT NULL,
  rule_version TEXT,
  ledger_id INTEGER NOT NULL REFERENCES jiu_coin_ledger(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_user_created
  ON reward_claims(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reward_claims_ledger
  ON reward_claims(ledger_id);
