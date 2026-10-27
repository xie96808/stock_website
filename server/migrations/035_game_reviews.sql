-- 035: 付费复盘 (additive only): per-game unlocks bought with 韭币.
--   product 'route' = 最优路线重演, 'hold' = 死拿对照 (needs 'route' first; enforced in code).
-- Coins go through jiu_coin_ledger (reason 'review_purchase', negative delta, ref_id '<gameId>:<product>'),
-- unique per game+product so a double tap / second tab can never charge twice.
CREATE TABLE IF NOT EXISTS game_reviews (
  game_id TEXT NOT NULL REFERENCES game_sessions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  product TEXT NOT NULL CHECK (product IN ('route', 'hold')),
  price INTEGER NOT NULL CHECK (price >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, product)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_game_reviews_user ON game_reviews(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_review_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'review_purchase';
