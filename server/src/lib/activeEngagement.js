export function findActiveEngagement(db, userId, nowIso) {
  const row = db
    .prepare(
      `SELECT id FROM intraday_sessions
       WHERE user_id = ? AND status = 'active' AND expires_at > ?`
    )
    .get(userId, nowIso);
  if (!row) return null;
  return { sessionId: row.id };
}
