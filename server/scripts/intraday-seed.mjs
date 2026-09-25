#!/usr/bin/env node
/**
 * Publish near-term intraday challenges. Safe to re-run; existing dates are not rewritten.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const { migrate } = await import("../src/db/migrate.js");
migrate();
const { seedNearIntradayChallenges } = await import("../src/lib/intraday.js");
const { closeDb } = await import("../src/db/connection.js");
const created = seedNearIntradayChallenges();
console.log(JSON.stringify({ created }));
closeDb();
