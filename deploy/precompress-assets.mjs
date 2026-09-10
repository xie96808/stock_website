#!/usr/bin/env node
// Precompress text assets for nginx gzip_static + brotli_static.
// Usage: node deploy/precompress-assets.mjs <release-dir>
//
// Writes sibling .gz and .br next to each matching source file.
// Large files (>1 MiB) use brotli quality 5 to keep CI time sane;
// smaller files use quality 11.
import {
  brotliCompressSync,
  gzipSync,
  constants as zc,
} from "node:zlib";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  linkSync,
} from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: precompress-assets.mjs <release-dir>");
  process.exit(2);
}

const TEXT_EXTS = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt", ".xml"]);
const SKIP_NAMES = new Set([".DS_Store"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_NAMES.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function shouldCompress(path) {
  if (path.endsWith(".gz") || path.endsWith(".br")) return false;
  return TEXT_EXTS.has(extname(path).toLowerCase());
}

const files = walk(ROOT).filter(shouldCompress);
let gzCount = 0;
let brCount = 0;
let linkCount = 0;
const t0 = Date.now();
/** @type {Map<number, { gz: string, br: string }>} */
const byInode = new Map();

for (const file of files) {
  const st = statSync(file);
  if (st.size < 32) continue; // not worth it

  const gzPath = `${file}.gz`;
  const brPath = `${file}.br`;
  const prior = byInode.get(st.ino);
  if (prior) {
    // Same bytes as an already-compressed hardlink twin (versioned pack).
    for (const [src, dest] of [
      [prior.gz, gzPath],
      [prior.br, brPath],
    ]) {
      if (existsSync(dest)) continue;
      try {
        linkSync(src, dest);
        linkCount++;
      } catch {
        writeFileSync(dest, readFileSync(src));
      }
    }
    gzCount++;
    brCount++;
    continue;
  }

  const buf = readFileSync(file);

  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(gzPath, gz);
  gzCount++;

  const quality = buf.length > 1_048_576 ? 5 : 11;
  const br = brotliCompressSync(buf, {
    params: {
      [zc.BROTLI_PARAM_QUALITY]: quality,
      [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
    },
  });
  writeFileSync(brPath, br);
  brCount++;
  byInode.set(st.ino, { gz: gzPath, br: brPath });

  if (buf.length > 1_048_576) {
    const ratio = (br.length / buf.length * 100).toFixed(1);
    console.log(
      `precompress ${file.slice(ROOT.length + 1)}: ${(buf.length / 1e6).toFixed(1)}MB -> br ${(br.length / 1e6).toFixed(1)}MB (${ratio}%, q${quality})`
    );
  }
}

console.log(
  `precompress done: ${gzCount} .gz, ${brCount} .br, ${linkCount} hardlink-reuse in ${((Date.now() - t0) / 1000).toFixed(1)}s`
);
