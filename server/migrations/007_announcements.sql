-- System announcements (public modal + admin CRUD)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_public
  ON announcements(status, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_admin
  ON announcements(status, updated_at DESC, id DESC);

-- Seed first published welcome notice (idempotent by body match)
INSERT INTO announcements (title, body, status, published_at, created_at, updated_at, created_by)
SELECT NULL,
       '欢迎各位来访！登录后再开玩，和我的朋友们一起 PK～',
       'published',
       datetime('now'),
       datetime('now'),
       datetime('now'),
       NULL
WHERE NOT EXISTS (
  SELECT 1 FROM announcements
  WHERE body = '欢迎各位来访！登录后再开玩，和我的朋友们一起 PK～'
);
