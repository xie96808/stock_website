-- Admin batch 3 (additive only).
-- Internal handling note on feedback (admin-only; never shown to the user).
ALTER TABLE user_feedback ADD COLUMN admin_note TEXT;
ALTER TABLE user_feedback ADD COLUMN admin_note_by INTEGER;
ALTER TABLE user_feedback ADD COLUMN admin_note_at TEXT;
-- Scheduled publish: a draft with scheduled_at is promoted to published once due.
ALTER TABLE announcements ADD COLUMN scheduled_at TEXT;
-- Audit filters (action / target lookups) stay fast as the log grows.
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_id ON audit_logs(action, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON audit_logs(target_type, target_id, id DESC);
