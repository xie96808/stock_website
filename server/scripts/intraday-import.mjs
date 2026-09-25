#!/usr/bin/env node
/**
 * Import the intraday JSONL tail (or the whole file with --full).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const full = process.argv.includes("--full");
const { migrate } = await import("../src/db/migrate.js");
migrate();
const { importIntradayTail } = await import("../src/lib/intradayPack.js");
const { closeDb } = await import("../src/db/connection.js");
const result = importIntradayTail(undefined, { full });
console.log(JSON.stringify(result));
closeDb();
