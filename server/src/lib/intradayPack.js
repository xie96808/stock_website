/**
 * JSONL tail import. Startup reads only new bytes; --full is the manual rescan.
 * sha256 is validateTape's canonical string — do not build a second JSON form.
 */
import fs from "node:fs";
import { openDb } from "../db/connection.js";
import { validateTape, tapeSha256 } from "../../../shared/intradayTape.js";

export const DEFAULT_INTRADAY_PATH = "/var/lib/stockgame/intraday.jsonl";
export const INTRADAY_READY_MIN_TAPES = 20;
export const INTRADAY_READY_MIN_DATES = 7;

export function intradayJsonlPath() {
  const raw = process.env.STOCKGAME_INTRADAY_PATH;
  if (raw && String(raw).trim()) return String(raw).trim();
  return DEFAULT_INTRADAY_PATH;
}

export function intradayLibraryStatus(db = openDb()) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS tapes, COUNT(DISTINCT session_date) AS dates
       FROM intraday_tapes WHERE eligible = 1`
    )
    .get();
  const tapeCount = Number(row?.tapes) || 0;
  const dateCount = Number(row?.dates) || 0;
  return {
    tapeCount,
    dateCount,
    ready: tapeCount >= INTRADAY_READY_MIN_TAPES && dateCount >= INTRADAY_READY_MIN_DATES,
  };
}

const INSERT_TAPE = `INSERT OR IGNORE INTO intraday_tapes (
  id, pack_version, symbol, name, session_date, prev_close_fen, limit_pct,
  bar_count, bars_json, sha256, eligible
) VALUES (?, ?, ?, ?, ?, ?, ?, 241, ?, ?, 1)`;

/** Insert one already-decoded tape object. Existing (symbol, session_date) is left untouched. */
export function insertValidatedTape(db, input) {
  const validated = validateTape(input);
  if (!validated.ok) return { ok: false, reason: validated.reason, index: validated.index };
  const sha = tapeSha256(validated.canonicalJson);
  if (sha !== validated.sha256) return { ok: false, reason: "sha" };
  const info = db.prepare(INSERT_TAPE).run(
    validated.sha256,
    validated.sha256,
    validated.canonical.symbol,
    validated.canonical.name,
    validated.canonical.sessionDate,
    validated.canonical.prevCloseFen,
    validated.canonical.limitPct,
    validated.canonicalJson,
    sha
  );
  return { ok: true, id: validated.sha256, inserted: info.changes === 1, validated };
}

export function readTape(db, id) {
  const row = db.prepare(`SELECT * FROM intraday_tapes WHERE id = ?`).get(id);
  if (!row || row.eligible !== 1) return { ok: false, reason: "missing" };
  if (tapeSha256(row.bars_json) !== row.sha256) return { ok: false, reason: "sha" };
  let parsed;
  try {
    parsed = JSON.parse(row.bars_json);
  } catch {
    return { ok: false, reason: "sha" };
  }
  const validated = validateTape(parsed);
  if (!validated.ok || validated.sha256 !== row.sha256) return { ok: false, reason: "sha" };
  return { ok: true, row, validated };
}

function consumeLines(buf) {
  const lines = [];
  let start = 0;
  let consumed = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0x0a) continue;
    let end = i;
    // Windows autocrlf checks the LF blob out as CRLF. Drop the CR before JSON.parse.
    if (end > start && buf[end - 1] === 0x0d) end -= 1;
    const line = buf.subarray(start, end).toString("utf8");
    consumed += i - start + 1;
    start = i + 1;
    if (line.trim()) lines.push(line);
  }
  return { lines, consumed };
}

/**
 * Continue from the stored byte offset. `full` rewinds the offset but still INSERT OR IGNORE.
 * @param {import("better-sqlite3").Database} [db]
 * @param {{ full?: boolean }} [opts]
 */
export function importIntradayTail(db = openDb(), { full = false } = {}) {
  const filePath = intradayJsonlPath();
  if (!fs.existsSync(filePath)) {
    return { imported: 0, skipped: 0, missing: true };
  }
  const run = db.transaction(() => {
    const stat = fs.statSync(filePath);
    const state = db
      .prepare(`SELECT byte_offset FROM intraday_import_state WHERE path = ?`)
      .get(filePath);
    let offset = full ? 0 : Number(state?.byte_offset || 0);
    if (!Number.isFinite(offset) || offset < 0 || offset > stat.size) offset = 0;
    if (!full && offset === stat.size) {
      return { imported: 0, skipped: 0, byteOffset: offset };
    }
    const length = stat.size - offset;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      if (length > 0) fs.readSync(fd, buf, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    const { lines, consumed } = consumeLines(buf);
    let imported = 0;
    let skipped = 0;
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      const result = insertValidatedTape(db, parsed);
      if (!result.ok || !result.inserted) skipped += 1;
      else imported += 1;
    }
    const byteOffset = offset + consumed;
    db.prepare(
      `INSERT INTO intraday_import_state (path, byte_offset, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         byte_offset = excluded.byte_offset,
         updated_at = excluded.updated_at`
    ).run(filePath, byteOffset, new Date().toISOString());
    return { imported, skipped, byteOffset };
  });
  return run.immediate();
}
