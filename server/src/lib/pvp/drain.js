/** Persistent drain. No row means accepting is allowed. A corrupt row stays closed. */
const DRAIN_KEY = "drain";

export function readDrain(db) {
  const row = db.prepare(`SELECT value_json FROM pvp_runtime_control WHERE key = ?`).get(DRAIN_KEY);
  if (!row) return false;
  try {
    return JSON.parse(row.value_json).draining === true;
  } catch {
    return true;
  }
}

export function writeDrainRow(db, { draining, actorId, reason, now }) {
  const value = JSON.stringify({
    draining: draining === true,
    actorId: actorId ?? null,
    reason: reason ?? null,
  });
  db.prepare(
    `INSERT INTO pvp_runtime_control (key, value_json, version, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       version = pvp_runtime_control.version + 1,
       updated_at = excluded.updated_at`
  ).run(DRAIN_KEY, value, now);
}
