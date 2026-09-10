#!/usr/bin/env node
/**
 * Emit versioned stocks pack + pack-meta for long-cache CDN/nginx.
 * Usage: node deploy/emit-versioned-pack.mjs <release-dir>
 *
 * - Hardlinks (or copies) data/stocks_data.json → data/stocks_data.<sha256>.json
 * - Writes data/pack-meta.json { datasetSha, packUrl, fallbackUrl, ... }
 * - Merges datasetSha / packUrl into version.json when present
 *
 * datasetSha matches server `getDatasetMeta().datasetVersion` (sha256 of file bytes).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  linkSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: emit-versioned-pack.mjs <release-dir>");
  process.exit(2);
}

const jsonRel = join("data", "stocks_data.json");
const jsonPath = join(ROOT, jsonRel);
if (!existsSync(jsonPath)) {
  console.error("missing", jsonRel);
  process.exit(1);
}

const buf = readFileSync(jsonPath);
const sha = createHash("sha256").update(buf).digest("hex");
const versionedName = `stocks_data.${sha}.json`;
const versionedRel = join("data", versionedName);
const versionedPath = join(ROOT, versionedRel);

if (!existsSync(versionedPath)) {
  try {
    linkSync(jsonPath, versionedPath);
  } catch (err) {
    console.warn("hardlink failed, copying pack:", err && err.message);
    copyFileSync(jsonPath, versionedPath);
  }
}

const meta = {
  datasetSha: sha,
  datasetVersion: sha,
  packUrl: `data/${versionedName}`,
  fallbackUrl: "data/stocks_data.json",
  fallbackJsUrl: "data/stocks_data.js",
};
const metaPath = join(ROOT, "data", "pack-meta.json");
writeFileSync(metaPath, JSON.stringify(meta, null, 0) + "\n");

const versionPath = join(ROOT, "version.json");
if (existsSync(versionPath)) {
  let version;
  try {
    version = JSON.parse(readFileSync(versionPath, "utf8"));
  } catch {
    version = {};
  }
  if (!version || typeof version !== "object") version = {};
  version.datasetSha = sha;
  version.packUrl = meta.packUrl;
  writeFileSync(versionPath, JSON.stringify(version) + "\n");
}

console.log(`emit-versioned-pack: ${versionedRel} (sha ${sha.slice(0, 12)}…)`);
