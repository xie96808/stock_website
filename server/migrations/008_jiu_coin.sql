-- 韭币 (jiu coin) economy: balances, ledger, daily claims + one-time active-user backfill
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN jiu_coin_balance INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS jiu_coin_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jiu_coin_ledger_user_created
  ON jiu_coin_ledger(user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_backfill_once
  ON jiu_coin_ledger(user_id) WHERE reason = 'backfill_grant';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_register_once
  ON jiu_coin_ledger(user_id) WHERE reason = 'register_grant';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_game_create_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'game_create' AND ref_type = 'game';

CREATE TABLE IF NOT EXISTS jiu_coin_daily_claims (
  user_id INTEGER NOT NULL REFERENCES users(id),
  claim_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 50 AND 200),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, claim_date)
);

-- One-time +1000 for every active user present at migrate (idempotent unique index)
INSERT INTO jiu_coin_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
SELECT u.id, 1000, 1000, 'backfill_grant', 'migration', '008_jiu_coin'
FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM jiu_coin_ledger l
    WHERE l.user_id = u.id AND l.reason = 'backfill_grant'
  );

UPDATE users
SET jiu_coin_balance = 1000,
    updated_at = datetime('now')
WHERE status = 'active'
  AND EXISTS (
    SELECT 1 FROM jiu_coin_ledger l
    WHERE l.user_id = users.id
      AND l.reason = 'backfill_grant'
      AND l.ref_id = '008_jiu_coin'
  );
