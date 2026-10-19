-- 027: user inventory (Track R1, 后悔券). Additive only: two new tables + indexes. No existing table is touched.
-- Design: lucky-wheel DESIGN.md Rev 4 §8.2.
CREATE TABLE IF NOT EXISTS user_items (
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0 AND qty <= 999),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_type)
);

CREATE TABLE IF NOT EXISTS user_item_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  qty_after INTEGER NOT NULL CHECK (qty_after >= 0),
  reason TEXT NOT NULL,                -- wheel_prize | rewind_use | admin_grant | admin_revoke
  ref_type TEXT,
  ref_id TEXT,
  meta_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uil_user ON user_item_ledger(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_uil_reason_created ON user_item_ledger(reason, created_at);
-- Idempotency / once-only guards.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uil_wheel_once ON user_item_ledger(ref_id, item_type) WHERE reason = 'wheel_prize';
CREATE UNIQUE INDEX IF NOT EXISTS idx_uil_rewind_once ON user_item_ledger(ref_id) WHERE reason = 'rewind_use';
CREATE UNIQUE INDEX IF NOT EXISTS idx_uil_admin_once ON user_item_ledger(ref_id) WHERE reason IN ('admin_grant', 'admin_revoke') AND ref_id IS NOT NULL;

-- Why a wheel prize was paid as coins instead (NULL = not substituted / older rows):
-- spin_cap | ticket_daily_cap | ticket_hold_cap | items_unavailable | rewind_disabled
ALTER TABLE lucky_wheel_spins ADD COLUMN substitute_reason TEXT;
