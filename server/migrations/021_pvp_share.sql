-- Open share links. A friend who opens the link is seated in waiting_ready.
-- The match still points at a real pvp_challenges row.

CREATE TABLE IF NOT EXISTS pvp_share_links (
  code TEXT PRIMARY KEY,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'joined', 'cancelled', 'expired')),
  match_id TEXT REFERENCES pvp_matches(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvp_share_one_open
  ON pvp_share_links(from_user_id) WHERE status = 'open';
