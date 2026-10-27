-- 034: 对战装扮 (additive only): sticker packs + entrance effects bought with 韭币.
--   users.pvp_entrance   the equipped entrance effect id (NULL = none); validated against the code-side catalogue on read.
--   user_cosmetics       owned items (sticker packs and entrance effects share one table; ids are unique across kinds).
-- Coins go through jiu_coin_ledger (reason 'cosmetic_purchase', negative delta, ref_id '<userId>:<itemId>').
ALTER TABLE users ADD COLUMN pvp_entrance TEXT;

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'entrance')),
  price INTEGER NOT NULL CHECK (price >= 0),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_cosmetic_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'cosmetic_purchase';
