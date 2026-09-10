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
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
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
const t0 = Date.now();

for (const file of files) {
  const buf = readFileSync(file);
  if (buf.length < 32) continue; // not worth it

  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(`${file}.gz`, gz);
  gzCount++;

  const quality = buf.length > 1_048_576 ? 5 : 11;
  const br = brotliCompressSync(buf, {
    params: {
      [zc.BROTLI_PARAM_QUALITY]: quality,
      [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
    },
  });
  writeFileSync(`${file}.br`, br);
  brCount++;

  if (buf.length > 1_048_576) {
    const ratio = (br.length / buf.length * 100).toFixed(1);
    console.log(
      `precompress ${file.slice(ROOT.length + 1)}: ${(buf.length / 1e6).toFixed(1)}MB -> br ${(br.length / 1e6).toFixed(1)}MB (${ratio}%, q${quality})`
    );
  }
}

console.log(
  `precompress done: ${gzCount} .gz, ${brCount} .br in ${((Date.now() - t0) / 1000).toFixed(1)}s`
);
