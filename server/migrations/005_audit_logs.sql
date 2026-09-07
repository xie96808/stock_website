-- Stage 5: audit logs for minimal governance
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs(actor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at);
