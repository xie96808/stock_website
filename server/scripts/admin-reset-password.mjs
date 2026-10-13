#!/usr/bin/env node
/**
 * Lockout recovery (CLI only — needs shell on the API host, same trust as admin-promote).
 * Sets a one-time temporary password for an ADMIN account, revokes its sessions,
 * writes an audit row (actor = null / reason "cli lockout recovery"), prints the
 * temp password once. Non-admin targets need --allow-user.
 * Usage (from server/ with env loaded):
 *   node scripts/admin-reset-password.mjs <username> [--allow-user]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const args = process.argv.slice(2);
const allowUser = args.includes("--allow-user");
const username = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
if (!username) {
  console.error("Usage: node scripts/admin-reset-password.mjs <username> [--allow-user]");
  process.exit(1);
}

const { migrate } = await import("../src/db/migrate.js");
migrate();
const { openDb, closeDb } = await import("../src/db/connection.js");
const { hashPassword } = await import("../src/lib/crypto.js");
const { updatePassword } = await import("../src/lib/users.js");
const { revokeAllUserSessions } = await import("../src/lib/sessions.js");
const { writeAuditLog } = await import("../src/lib/audit.js");

const row = openDb()
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
if (row.role !== "admin" && !allowUser) {
  console.error("target is not an admin; pass --allow-user to reset a regular user (prefer the web admin)");
  closeDb();
  process.exit(4);
}
const A = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
let temp = "";
for (let i = 0; i < 14; i += 1) temp += A[randomInt(A.length)];
temp += "23456789"[randomInt(8)];
updatePassword(row.id, await hashPassword(temp));
revokeAllUserSessions(row.id);
writeAuditLog({
  actorId: null,
  action: "user.password_reset",
  targetType: "user",
  targetId: String(row.id),
  reason: "cli lockout recovery",
});
console.log(`reset ${row.username_normalized} (id=${row.id}, role=${row.role}); sessions revoked`);
console.log(`TEMP_PASSWORD=${temp}`);
console.log("Log in with it, then change it in 后台 → 安全 → 修改我的密码.");
closeDb();
