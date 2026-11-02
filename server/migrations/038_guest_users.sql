-- 游客先玩: a guest is a real `users` row flagged is_guest = 1 (random placeholder username, unusable password hash).
-- Registering upgrades the same row in place, so games / ledger / history stay attached to one user id.
-- last_active_at drives the 30-day cleanup of guests that never registered.

ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1));
ALTER TABLE users ADD COLUMN last_active_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_guest_activity ON users(last_active_at) WHERE is_guest = 1;

-- One guest start grant per user (mirrors register_grant).
CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_guest_grant_once
  ON jiu_coin_ledger(user_id) WHERE reason = 'guest_grant';
