#!/usr/bin/env node
// Inspect / verify a bundled server/node_modules for the production target.
//   node deploy/check-native-bundle.mjs write <serverDir>   → writes <serverDir>/.native-bundle.json
//   node deploy/check-native-bundle.mjs verify <serverDir>  → exit 1 unless this node can load it
// Target: Ubuntu 22.04 (glibc 2.35), Node 22.x (ABI 127) — see .nvmrc / README-api.md.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const MAX_GLIBC = process.env.MAX_GLIBC || "2.35";
const NATIVE = ["better-sqlite3", "argon2"];
const [, , mode, dirArg] = process.argv;
const dir = path.resolve(dirArg || "server");
const cmpVer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

function nodeFiles(root) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".node")) out.push(p); } };
  walk(path.join(root, "node_modules"));
  return out;
}
function glibcNeeded(file) {
  const s = fs.readFileSync(file).toString("latin1");
  let max = "0";
  for (const m of s.matchAll(/GLIBC_(2\.\d+(?:\.\d+)?)/g)) if (cmpVer(m[1], max) > 0) max = m[1];
  return max;
}
function loadAll() {
  const req = createRequire(path.join(dir, "package.json"));
  const Database = req("better-sqlite3");
  const db = new Database(":memory:"); db.prepare("select 1").get(); db.close();
  req("argon2");
  return true;
}

if (mode === "write") {
  const files = nodeFiles(dir).map((f) => ({ file: path.relative(dir, f), glibc: glibcNeeded(f) }));
  const worst = files.reduce((m, f) => (cmpVer(f.glibc, m) > 0 ? f.glibc : m), "0");
  if (cmpVer(worst, MAX_GLIBC) > 0) { console.error(`native addon needs GLIBC_${worst} > target ${MAX_GLIBC}:`, files.filter((f) => cmpVer(f.glibc, MAX_GLIBC) > 0)); process.exit(1); }
  loadAll();
  const meta = { node: process.versions.node, modules: process.versions.modules, platform: process.platform, arch: process.arch, maxGlibcRequired: worst, targetGlibc: MAX_GLIBC, native: NATIVE, files };
  fs.writeFileSync(path.join(dir, ".native-bundle.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`NATIVE_BUNDLE_OK abi=${meta.modules} node=${meta.node} glibc<=${worst}`);
} else if (mode === "verify") {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, ".native-bundle.json"), "utf8"));
  if (meta.modules !== process.versions.modules || meta.platform !== process.platform || meta.arch !== process.arch) {
    console.error(`ABI mismatch: bundle abi=${meta.modules} ${meta.platform}/${meta.arch} (node ${meta.node}) vs runtime abi=${process.versions.modules} ${process.platform}/${process.arch} (node ${process.versions.node})`);
    process.exit(1);
  }
  loadAll();
  console.log(`NATIVE_VERIFY_OK abi=${process.versions.modules} node=${process.versions.node}`);
} else {
  console.error("usage: check-native-bundle.mjs write|verify <serverDir>"); process.exit(2);
}
