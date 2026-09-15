import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getDbPath } from "./connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

export function migrate(db = openDb()) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id)
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    // SQLite cannot ALTER CHECK; 016 rebuilds game_sessions. PRAGMA foreign_keys
    // cannot change *inside* a transaction, so drop FKs around that file only.
    const rebuildSessions = file === "016_oneshot_modifiers.sql";
    if (rebuildSessions) db.pragma("foreign_keys = OFF");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
    });
    tx();
    if (rebuildSessions) db.pragma("foreign_keys = ON");
    console.log("applied", file);
  }
  console.log("db", getDbPath());
  return db;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) migrate();
