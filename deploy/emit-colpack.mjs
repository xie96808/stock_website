#!/usr/bin/env node
// Emit data/stocks_data.json.colpack next to the JSON (memory plan P1).
// The API loads it at boot instead of JSON.parse-ing 56 MB (see server/src/lib/colpack.js).
// usage: node deploy/emit-colpack.mjs <release-dir | path/to/stocks_data.json>
import fs from "node:fs";
import path from "node:path";
import { buildColpackFromJson, decodeColpack, COLPACK_SUFFIX } from "../server/src/lib/colpack.js";

const arg = process.argv[2];
if (!arg) { console.error("usage: emit-colpack.mjs <release-dir|stocks_data.json>"); process.exit(2); }
const json = fs.statSync(arg).isDirectory() ? path.join(arg, "data", "stocks_data.json") : arg;
const out = json + COLPACK_SUFFIX;
const buf = buildColpackFromJson(json);
const d = decodeColpack(buf); // self-check
fs.writeFileSync(out, buf);
console.log(`COLPACK_OK ${path.basename(out)} bytes=${buf.length} stocks=${d.pack.length} source=${d.sourceSha256.slice(0, 12)}`);
