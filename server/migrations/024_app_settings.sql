-- Admin runtime overrides for env feature switches / PvP params.
-- No row => the env/config value applies (production behavior unchanged until an admin saves).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
