#!/usr/bin/env node
/**
 * Promote an existing user to role=admin (CLI only — no web privilege escalation).
 * Usage (from server/ with env loaded):
 *   node scripts/admin-promote.mjs <username>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const username = (process.argv[2] || "").trim().toLowerCase();
if (!username) {
  console.error("Usage: node scripts/admin-promote.mjs <username>");
  process.exit(1);
}

const { migrate } = await import("../src/db/migrate.js");
migrate();
const { openDb, closeDb } = await import("../src/db/connection.js");
const db = openDb();
const row = db
  .prepare("SELECT id, username_normalized, role, status FROM users WHERE username_normalized = ?")
  .get(username);
if (!row) {
  console.error("user not found:", username);
  closeDb();
  process.exit(2);
}
if (row.status !== "active") {
  console.error("user not active:", row.status);
  closeDb();
  process.exit(3);
}
db.prepare(
  `UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?`
).run(row.id);
console.log(`promoted ${row.username_normalized} (id=${row.id}) to admin`);
closeDb();
