#!/usr/bin/env node
/**
 * After CLI db:restore, replay active user_tombstones so soft-deleted accounts
 * stay deleted (avoid resurrection from an older backup).
 *
 * Usage (API host, env loaded, stockgame-api STOPPED preferred):
 *   node scripts/replay-tombstones.mjs
 *   node scripts/replay-tombstones.mjs --dry-run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const dryRun = process.argv.includes("--dry-run");

const { migrate } = await import("../src/db/migrate.js");
const { closeDb } = await import("../src/db/connection.js");
const { listActiveTombstones, replayUserTombstones } = await import("../src/lib/tombstones.js");

migrate();

if (dryRun) {
  const rows = listActiveTombstones();
  console.log("TOMBSTONE_DRY_RUN", JSON.stringify({ count: rows.length, items: rows }, null, 2));
  closeDb();
  process.exit(0);
}

const result = replayUserTombstones();
console.log("TOMBSTONE_REPLAY_OK", JSON.stringify(result));
closeDb();
