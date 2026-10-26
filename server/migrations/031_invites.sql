-- 031: 邀请奖励 (additive only: two new tables + two partial unique ledger indexes, nothing altered).
--   invite_codes        one lazily-created code per user (6 chars, unambiguous alphabet).
--   invite_redemptions  one row per invitee (an account can only ever be invited once).
--                       pending  = registered with a code, has not finished a game yet
--                       rewarded = first settled game happened, coins paid (inviter side may be capped: see inviter_coins)
--                       rejected = anti-abuse (same-IP cap / inviter inactive); nobody is paid
-- Coins go through jiu_coin_ledger: reason 'invite_inviter' / 'invite_invitee', ref_id = '<inviteeId>'.
CREATE TABLE IF NOT EXISTS invite_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_redemptions (
  invitee_id INTEGER PRIMARY KEY REFERENCES users(id),
  inviter_id INTEGER NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'rejected')),
  reject_reason TEXT,
  inviter_coins INTEGER NOT NULL DEFAULT 0 CHECK (inviter_coins >= 0),
  invitee_coins INTEGER NOT NULL DEFAULT 0 CHECK (invitee_coins >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rewarded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_redemptions_inviter ON invite_redemptions(inviter_id, status);
CREATE INDEX IF NOT EXISTS idx_invite_redemptions_ip ON invite_redemptions(ip_hash, rewarded_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_invite_inviter_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'invite_inviter';
CREATE UNIQUE INDEX IF NOT EXISTS idx_jiu_coin_ledger_invite_invitee_once
  ON jiu_coin_ledger(ref_id) WHERE reason = 'invite_invitee';
