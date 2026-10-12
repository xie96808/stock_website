-- Profile signature (个性签名) + force leaderboard opt-in open by default.
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN signature TEXT;

-- Product: privacy toggles removed from 资料设置; everyone participates.
UPDATE users SET leaderboard_opt_in = 1 WHERE leaderboard_opt_in = 0;
