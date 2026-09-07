-- Custom uploaded avatar (filename under STOCKGAME_DATA_DIR/avatars/)
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN avatar_custom_path TEXT;
