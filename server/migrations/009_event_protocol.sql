-- B0-PR1: event-v1 protocol columns on game_sessions + command audit for stepwise decisions.
-- Existing rows keep classic / legacy-batch / assist_class=legacy; new metrics stay nullable.
PRAGMA foreign_keys = ON;

ALTER TABLE game_sessions ADD COLUMN game_kind TEXT NOT NULL DEFAULT 'classic'
  CHECK (game_kind IN ('classic', 'daily', 'archive_practice', 'puzzle'));

ALTER TABLE game_sessions ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'legacy-batch'
  CHECK (protocol_version IN ('legacy-batch', 'event-v1'));

ALTER TABLE game_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK (revision >= 0);

ALTER TABLE game_sessions ADD COLUMN undo_count INTEGER NOT NULL DEFAULT 0
  CHECK (undo_count IN (0, 1));

ALTER TABLE game_sessions ADD COLUMN assist_class TEXT NOT NULL DEFAULT 'legacy'
  CHECK (assist_class IN ('legacy', 'clean', 'undo'));

ALTER TABLE game_sessions ADD COLUMN challenge_id TEXT;
ALTER TABLE game_sessions ADD COLUMN puzzle_version_id TEXT;
ALTER TABLE game_sessions ADD COLUMN initial_state_json TEXT;
ALTER TABLE game_sessions ADD COLUMN canonical_actions_json TEXT;
ALTER TABLE game_sessions ADD COLUMN economy_version TEXT;

CREATE INDEX IF NOT EXISTS idx_game_sessions_kind_protocol
  ON game_sessions(game_kind, protocol_version, status);

CREATE TABLE IF NOT EXISTS game_commands (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_sessions(id),
  command_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('advance', 'rewind', 'finish', 'abandon')),
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  event_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, command_key),
  UNIQUE (game_id, revision_after)
);

CREATE INDEX IF NOT EXISTS idx_game_commands_game_created
  ON game_commands(game_id, created_at DESC, id);
