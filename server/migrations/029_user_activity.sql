-- 029: usage tracking for the admin 「用户数据」 panel (additive only: three new tables, nothing altered).
-- Written by POST /api/v1/me/heartbeat (client sends one every ~30s while the page is visible and in use).
--   user_presence        one row per user: last heartbeat (ms) -> "online now" = beat within 90s.
--   user_activity_daily  per user per Asia/Shanghai day: accumulated active seconds + visit count.
--   user_activity_hourly one row per user per epoch-hour that had a heartbeat -> peak hours / hourly users.
CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  last_beat_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_user_activity_daily_day ON user_activity_daily(day, user_id);

CREATE TABLE IF NOT EXISTS user_activity_hourly (
  user_id INTEGER NOT NULL REFERENCES users(id),
  hour INTEGER NOT NULL,
  PRIMARY KEY (user_id, hour)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_user_activity_hourly_hour ON user_activity_hourly(hour);
