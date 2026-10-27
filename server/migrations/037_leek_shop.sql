-- 037: 韭菜商店 — 称号 + 改名卡 (additive only).
--   users.title          the equipped 称号 id (NULL = none); validated against the code-side catalogue on every read.
--   users.rename_cards   改名卡 in the bag. Changing a nickname spends one (when the feature flag is on).
--   user_titles          titles bought in the shop (one row per title; the title list lives in code, like 头像框).
--   nickname_changes     who renamed from what to what, and whether a card paid for it (moderation / impersonation trail).
-- Coins go through jiu_coin_ledger: 'title_purchase' (ref_id '<userId>:<titleId>', unique) and
-- 'rename_card_purchase' (ref_id '<userId>:<n>' where n = purchases so far, unique).
ALTER TABLE users ADD COLUMN title TEXT;
ALTER TABLE users ADD COLUMN rename_cards INTEGER NOT NULL DEFAULT 0 CHECK (rename_cards >= 0);

CREATE TABLE IF NOT EXISTS user_titles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  title_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS nickname_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  old_nickname TEXT NOT NULL,
  new_nickname TEXT NOT NULL,
  used_card INTEGER NOT NULL DEFAULT 0 CHECK (used_card IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nickname_changes_user ON nickname_changes(user_id, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_title_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'title_purchase';
CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_rename_card_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'rename_card_purchase';
