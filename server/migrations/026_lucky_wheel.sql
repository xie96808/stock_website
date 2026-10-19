-- 幸运转盘 (lucky wheel) — Batch 0. Additive only: new tables + one partial unique index.
-- Replaces the 每日领取 UX when the luckyWheelEnabled setting is ON (default OFF).
-- jiu_coin_daily_claims and all existing ledger rows stay untouched (history).
-- Item sectors (后悔券, Track R) and 'spin again' are expressed in the same tables:
--   prize_kind 'jiu_coin' | 'item' | 'spin'; item inventory itself lives in migration 027 (not here).
PRAGMA foreign_keys = ON;

-- Versioned, immutable prize configs. Admin edit = new row; the highest version is active.
CREATE TABLE IF NOT EXISTS lucky_wheel_configs (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  sectors_json TEXT NOT NULL,                 -- [{pos,kind,amount|item+qty,weight,jackpot?}] x8, weights sum 10000
  ticket_coin_value INTEGER NOT NULL DEFAULT 50 CHECK (ticket_coin_value BETWEEN 1 AND 500),
  ev_x100 INTEGER NOT NULL,                   -- configured expected value * 100 (coin-equivalents, tickets at face)
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Table A (coin-only launch table). EV 125.68. Must equal TABLE_A in server/src/lib/luckyWheel.js (test-enforced).
INSERT INTO lucky_wheel_configs (sectors_json, ticket_coin_value, ev_x100, note)
SELECT '[{"pos":0,"kind":"jiu_coin","amount":90,"weight":1800},{"pos":1,"kind":"jiu_coin","amount":300,"weight":700},{"pos":2,"kind":"jiu_coin","amount":50,"weight":1400},{"pos":3,"kind":"jiu_coin","amount":150,"weight":1400},{"pos":4,"kind":"jiu_coin","amount":70,"weight":2000},{"pos":5,"kind":"jiu_coin","amount":888,"weight":100,"jackpot":true},{"pos":6,"kind":"jiu_coin","amount":110,"weight":1600},{"pos":7,"kind":"jiu_coin","amount":200,"weight":1000}]',
       50, 12568, 'seed: Table A (coin-only)'
WHERE NOT EXISTS (SELECT 1 FROM lucky_wheel_configs);

-- One row per spin. Result is decided and persisted server-side before the client animates.
CREATE TABLE IF NOT EXISTS lucky_wheel_spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spin_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  idem_key TEXT NOT NULL,
  spin_date TEXT NOT NULL,                    -- Asia/Shanghai YYYY-MM-DD, decided at commit time
  source TEXT NOT NULL CHECK (source IN ('daily','credit')),
  slot INTEGER,                               -- 1..N for 'daily'; NULL for 'credit'
  credit_grant_id INTEGER,                    -- consumed grant for source='credit'
  config_version INTEGER NOT NULL REFERENCES lucky_wheel_configs(version),
  sector INTEGER NOT NULL CHECK (sector BETWEEN 0 AND 7),
  roll INTEGER NOT NULL CHECK (roll BETWEEN 0 AND 9999),
  drawn_kind TEXT NOT NULL CHECK (drawn_kind IN ('jiu_coin','item','spin')),   -- what the sector says
  prize_kind TEXT NOT NULL CHECK (prize_kind IN ('jiu_coin','item','spin')),   -- what was actually paid
  prize_item TEXT,                            -- item type when prize_kind='item'
  prize_qty INTEGER NOT NULL CHECK (prize_qty > 0),   -- coins | item count | spins
  coin_value INTEGER NOT NULL,                -- coin-equivalent at draw time (0 for 'spin')
  substituted INTEGER NOT NULL DEFAULT 0 CHECK (substituted IN (0,1)),
  is_jackpot INTEGER NOT NULL DEFAULT 0 CHECK (is_jackpot IN (0,1)),
  ledger_id INTEGER REFERENCES jiu_coin_ledger(id),   -- coin prizes
  item_ledger_id INTEGER,                     -- item prizes (user_item_ledger, migration 027)
  bonus_grant_id INTEGER,                     -- 'spin again' grant created by this spin
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, idem_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lw_daily_slot
  ON lucky_wheel_spins(user_id, spin_date, slot) WHERE source = 'daily';
CREATE INDEX IF NOT EXISTS idx_lw_user_created ON lucky_wheel_spins(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lw_date ON lucky_wheel_spins(spin_date);

-- Bonus spins: admin grants now; 'spin again' prizes; earn-by-play later. Consumed only after the daily free spin.
CREATE TABLE IF NOT EXISTS lucky_wheel_credit_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  spins INTEGER NOT NULL CHECK (spins > 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= spins),
  source_key TEXT UNIQUE,                     -- idempotency (wheel:<spin_id> | admin:<key>)
  reason TEXT NOT NULL,
  granted_by INTEGER,
  expires_date TEXT,                          -- Shanghai YYYY-MM-DD, usable while spin_date <= this; NULL = never
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lw_grants_user ON lucky_wheel_credit_grants(user_id, id);

-- Ledger: at most one coin payout per spin (belt and braces on top of reward_claims).
CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_lucky_wheel_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'lucky_wheel';
