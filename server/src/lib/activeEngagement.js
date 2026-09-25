/**
 * Cross-table active check used by classic / daily / ghost / puzzle creates.
 * Sweep stays in intraday.js so this module does not import settlement.
 * Callers must skip this entirely when intradayModeEnabled is false.
 */
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
