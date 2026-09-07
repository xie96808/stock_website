import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data");

let _db;

export function getDataDir() {
  return process.env.STOCKGAME_DATA_DIR || defaultDataDir;
}

export function getDbPath() {
  return process.env.STOCKGAME_DB_PATH || path.join(getDataDir(), "stockgame.sqlite");
}

/** @deprecated use getDbPath */
export const dbPath = getDbPath();
/** @deprecated use getDataDir */
export const dataDir = getDataDir();

export function openDb() {
  if (_db) return _db;
  const p = getDbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  _db = db;
  return db;
}

export function closeDb() {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}
