import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data");
export const dataDir = process.env.STOCKGAME_DATA_DIR || defaultDataDir;
export const dbPath = process.env.STOCKGAME_DB_PATH || path.join(dataDir, "stockgame.sqlite");

let _db;

export function openDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  _db = db;
  return db;
}
