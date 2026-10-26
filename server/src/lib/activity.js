import { openDb } from "../db/connection.js";

/** One heartbeat every ~30s from the client; presence counts as "online" for 3 missed-free beats. */
export const ONLINE_WINDOW_MS = 90 * 1000;
/** Beats closer than this are ignored (a second tab / a retry must not double count). */
export const MIN_BEAT_GAP_MS = 10 * 1000;
/** A gap longer than this starts a new visit (and credits no time for the gap itself). */
export const VISIT_GAP_MS = 5 * 60 * 1000;
/** Time credited for one beat is capped, so one missed beat still counts but a long stall never does. */
export const MAX_CREDIT_MS = 75 * 1000;
const HOUR_MS = 3600 * 1000;
const HOURLY_KEEP_DAYS = 100;
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;

/** Asia/Shanghai calendar day (YYYY-MM-DD) of an epoch-ms instant. */
export function shanghaiDay(ms) {
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

let lastPruneAt = 0;

function pruneHourly(db, now) {
  if (now - lastPruneAt < 6 * HOUR_MS) return;
  lastPruneAt = now;
  const cutoff = Math.floor(now / HOUR_MS) - HOURLY_KEEP_DAYS * 24;
  db.prepare(`DELETE FROM user_activity_hourly WHERE hour < ?`).run(cutoff);
}

/**
 * Record one heartbeat. Returns { accepted, creditedSeconds, newVisit }.
 * Pure SQLite, single transaction; safe to call from the request thread.
 */
export function recordHeartbeat(userId, now = Date.now(), db = openDb()) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return { accepted: false, creditedSeconds: 0, newVisit: false };
  const tx = db.transaction(() => {
    const prev = db.prepare(`SELECT last_beat_at FROM user_presence WHERE user_id = ?`).get(uid);
    const gap = prev ? now - prev.last_beat_at : Infinity;
    if (prev && gap >= 0 && gap < MIN_BEAT_GAP_MS) {
      return { accepted: false, creditedSeconds: 0, newVisit: false };
    }
    const newVisit = !prev || gap < 0 || gap > VISIT_GAP_MS;
    const creditedSeconds = newVisit ? 0 : Math.round(Math.min(gap, MAX_CREDIT_MS) / 1000);
    const day = shanghaiDay(now);
    db.prepare(
      `INSERT INTO user_activity_daily (user_id, day, active_seconds, visits) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         active_seconds = active_seconds + excluded.active_seconds,
         visits = visits + excluded.visits`
    ).run(uid, day, creditedSeconds, newVisit ? 1 : 0);
    db.prepare(`INSERT OR IGNORE INTO user_activity_hourly (user_id, hour) VALUES (?, ?)`).run(uid, Math.floor(now / HOUR_MS));
    db.prepare(
      `INSERT INTO user_presence (user_id, last_beat_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_beat_at = excluded.last_beat_at`
    ).run(uid, now);
    return { accepted: true, creditedSeconds, newVisit };
  });
  const out = tx();
  if (out.accepted) {
    try { pruneHourly(db, now); } catch { /* best effort */ }
  }
  return out;
}
