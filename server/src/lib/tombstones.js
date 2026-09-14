/**
 * Soft-delete tombstones: survive backup restore so deleted accounts stay deleted.
 *
 * Dual-write model:
 * - In-DB `user_tombstones` — convenient for live queries / admin tooling.
 * - External JSONL ledger under the data dir (`user-tombstones.jsonl`) — source of
 *   truth for post-restore replay. `db:restore` replaces only the main SQLite file,
 *   so this ledger is not wiped by restoring an older backup.
 *
 * Full DB restore remains CLI/server only — never a web admin button.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, getDataDir } from "../db/connection.js";
import { revokeAllUserSessions } from "./sessions.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";

export const TOMBSTONE_LEDGER_FILENAME = "user-tombstones.jsonl";

export function getTombstoneLedgerPath() {
  return (
    process.env.STOCKGAME_TOMBSTONE_LEDGER_PATH ||
    path.join(getDataDir(), TOMBSTONE_LEDGER_FILENAME)
  );
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureLedgerDir(ledgerPath) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
}

/**
 * Append one JSONL event. Atomic enough for single-process API (rename of whole
 * file is unnecessary; crash mid-line is skipped on fold).
 */
function appendLedgerEvent(event) {
  const ledgerPath = getTombstoneLedgerPath();
  ensureLedgerDir(ledgerPath);
  const line = `${JSON.stringify({ v: 1, ...event })}\n`;
  fs.appendFileSync(ledgerPath, line, "utf8");
}

/**
 * Fold JSONL into active tombstones (latest unrevesed add per user_id).
 * @returns {Map<number, object>}
 */
function foldLedgerEvents(events) {
  /** @type {Map<number, object>} */
  const byUser = new Map();
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const userId = Number(ev.user_id);
    if (!Number.isFinite(userId)) continue;
    if (ev.op === "add") {
      byUser.set(userId, {
        user_id: userId,
        username_normalized: String(ev.username_normalized || "").toLowerCase(),
        source: ev.source === "admin" ? "admin" : "self",
        reason: ev.reason != null ? String(ev.reason) : null,
        created_at: ev.created_at || null,
      });
    } else if (ev.op === "reverse") {
      byUser.delete(userId);
    }
  }
  return byUser;
}

function readLedgerRawEvents() {
  const ledgerPath = getTombstoneLedgerPath();
  if (!fs.existsSync(ledgerPath)) return [];
  const text = fs.readFileSync(ledgerPath, "utf8");
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      /* skip corrupt/partial trailing line */
    }
  }
  return events;
}

/**
 * Seed external ledger from in-DB active rows when the file is missing/empty.
 * One-time migration for hosts that already have tombstones only in SQLite.
 */
function seedLedgerFromDbIfNeeded() {
  const ledgerPath = getTombstoneLedgerPath();
  if (fs.existsSync(ledgerPath) && fs.statSync(ledgerPath).size > 0) return;
  let rows = [];
  try {
    rows = openDb()
      .prepare(
        `SELECT user_id, username_normalized, source, reason, created_at
         FROM user_tombstones
         WHERE reversed_at IS NULL
         ORDER BY id ASC`
      )
      .all();
  } catch {
    return;
  }
  if (!rows.length) return;
  ensureLedgerDir(ledgerPath);
  const lines = rows.map((r) =>
    JSON.stringify({
      v: 1,
      op: "add",
      user_id: r.user_id,
      username_normalized: r.username_normalized,
      source: r.source,
      reason: r.reason,
      created_at: r.created_at,
      seeded_from_db: true,
    })
  );
  fs.writeFileSync(ledgerPath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Active tombstones from the external ledger (SoT for replay).
 * @returns {Array<{user_id:number, username_normalized:string, source:string, reason:string|null, created_at:string|null}>}
 */
export function listActiveTombstonesFromLedger() {
  seedLedgerFromDbIfNeeded();
  const map = foldLedgerEvents(readLedgerRawEvents());
  return [...map.values()].sort((a, b) => a.user_id - b.user_id);
}

export function writeUserTombstone({
  userId,
  usernameNormalized,
  source,
  reason = null,
}) {
  if (!userId || !usernameNormalized || (source !== "self" && source !== "admin")) {
    throw new Error("tombstone requires userId, usernameNormalized, source");
  }
  const username = String(usernameNormalized).toLowerCase();
  const reasonStr = reason != null ? String(reason) : null;
  const createdAt = nowIso();

  const info = openDb()
    .prepare(
      `INSERT INTO user_tombstones (user_id, username_normalized, source, reason)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, username, source, reasonStr);

  appendLedgerEvent({
    op: "add",
    user_id: userId,
    username_normalized: username,
    source,
    reason: reasonStr,
    created_at: createdAt,
    db_row_id: Number(info.lastInsertRowid),
  });

  return info.lastInsertRowid;
}

export function reverseActiveTombstonesForUser(userId) {
  openDb()
    .prepare(
      `UPDATE user_tombstones SET reversed_at = datetime('now')
       WHERE user_id = ? AND reversed_at IS NULL`
    )
    .run(userId);

  appendLedgerEvent({
    op: "reverse",
    user_id: userId,
    reversed_at: nowIso(),
  });
}

/**
 * Prefer external ledger (survives main-DB restore). Falls back to in-DB after
 * seeding ledger from DB when the file was empty.
 */
export function listActiveTombstones() {
  const fromLedger = listActiveTombstonesFromLedger();
  if (fromLedger.length > 0) {
    return fromLedger.map((t, i) => ({
      id: i + 1,
      user_id: t.user_id,
      username_normalized: t.username_normalized,
      source: t.source,
      reason: t.reason,
      created_at: t.created_at,
    }));
  }
  // Empty ledger after seed → trust DB (no active rows either, or seed failed).
  try {
    return openDb()
      .prepare(
        `SELECT id, user_id, username_normalized, source, reason, created_at
         FROM user_tombstones
         WHERE reversed_at IS NULL
         ORDER BY id ASC`
      )
      .all();
  } catch {
    return [];
  }
}

/**
 * Apply active tombstones from the **external ledger** to the current DB
 * (e.g. after restore from backup). Soft-deletes matching users (by user_id,
 * else username), revokes sessions. Does not wipe credentials again if already
 * deleted.
 * @returns {{ applied: number, alreadyDeleted: number, missing: number, total: number, source: string }}
 */
export function replayUserTombstones() {
  const db = openDb();
  const rows = listActiveTombstonesFromLedger();
  let applied = 0;
  let alreadyDeleted = 0;
  let missing = 0;

  const tx = db.transaction(() => {
    for (const t of rows) {
      let user = db.prepare("SELECT * FROM users WHERE id = ?").get(t.user_id);
      if (!user) {
        user = db
          .prepare("SELECT * FROM users WHERE username_normalized = ?")
          .get(t.username_normalized);
      }
      if (!user) {
        missing += 1;
        continue;
      }
      if (user.status === "deleted") {
        alreadyDeleted += 1;
        continue;
      }
      db.prepare(
        `UPDATE users SET status = 'deleted', deleted_at = datetime('now'),
          updated_at = datetime('now'), password_hash = '!', recovery_code_hash = NULL
         WHERE id = ?`
      ).run(user.id);
      revokeAllUserSessions(user.id);
      applied += 1;
    }
  });
  tx();
  if (applied > 0) invalidateLeaderboardCache();
  return {
    applied,
    alreadyDeleted,
    missing,
    total: rows.length,
    source: "external-ledger",
    ledgerPath: getTombstoneLedgerPath(),
  };
}
