#!/usr/bin/env node
/**
 * Activate a preset lucky-wheel prize table as a NEW config version (same validation + audit as the admin save).
 * Dry run by default. Run from server/ with the service env loaded (GAME_REWIND_ENABLED etc.):
 *   node scripts/activate-wheel-table.mjs C1                       # dry run: prints sectors + EV, writes nothing
 *   node scripts/activate-wheel-table.mjs C1 --apply --reason "Bill 批准表 C1"
 * Presets: A (coin-only launch), B (DESIGN §8.4), C1 (recommended Table C), C2 (Table C, fewer tickets).
 * Rollback: run again with A (or use admin 转盘 → restore version). Spins already made keep their version.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const args = process.argv.slice(2);
const name = (args[0] || "").toUpperCase();
const apply = args.includes("--apply");
const ri = args.indexOf("--reason");
const reason = ri >= 0 ? args[ri + 1] : "";

const { migrate } = await import("../src/db/migrate.js");
migrate();
const { openDb, closeDb } = await import("../src/db/connection.js");
const { loadAppSettings } = await import("../src/lib/appSettings.js");
loadAppSettings(openDb());
await import("../src/lib/wheelItems.js"); // item sectors need the inventory granter, as in the server
const W = await import("../src/lib/luckyWheel.js");
const table = W.WHEEL_TABLES[name];
if (!table) {
  console.error(`usage: activate-wheel-table.mjs <${Object.keys(W.WHEEL_TABLES).join("|")}> [--apply --reason "..."]`);
  process.exit(1);
}
const v = W.validateWheelConfig({ sectors: table, ticketCoinValue: W.DEFAULT_TICKET_COIN_VALUE });
const before = W.getActiveConfig(openDb());
console.log(JSON.stringify({ preset: name, valid: v.ok, code: v.code, message: v.message, ev: v.ev, warnings: v.warnings, activeVersion: before.version }, null, 2));
for (const s of table) console.log(`  pos ${s.pos}  ${s.kind.padEnd(8)} ${s.kind === "jiu_coin" ? s.amount : s.kind === "item" ? `${s.item} x${s.qty}` : "再转一次"}  ${(s.weight / 100).toFixed(2)}%${s.jackpot ? "  ★jackpot" : ""}`);
if (!v.ok) {
  closeDb();
  process.exit(2);
}
if (apply && reason.trim().length < 2) {
  console.error("--apply needs --reason \"...\" (2–200 chars)");
  closeDb();
  process.exit(1);
}
if (!apply) {
  console.log("dry run — nothing written. Add --apply --reason \"...\" to activate.");
  closeDb();
  process.exit(0);
}
const r = W.adminSaveConfig({ actorId: null, input: { sectors: table, ticketCoinValue: W.DEFAULT_TICKET_COIN_VALUE }, reason: `script ${name}: ${reason}` });
console.log(JSON.stringify(r));
closeDb();
process.exit(r.ok ? 0 : 3);
