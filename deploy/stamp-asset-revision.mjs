#!/usr/bin/env node
// Inject ?v=<revision> into local JS/CSS references so 7-day browser caches
// refresh after deploy without changing module behavior.
//
// Stamps (in place under release-dir):
//   - index.html / admin HTML: link href, script src, inline ESM from '...'
//   - js/ and shared/ *.js, admin/*.js: relative import / dynamic import /
//     new URL('./worker.js', import.meta.url)
//   - css/*.css, admin/*.css: @import url('...')
//
// Does NOT rewrite remote (https:) URLs, data: URLs, or pack JSON URLs
// (versioned pack URL deferred).
//
// Usage: node deploy/stamp-asset-revision.mjs <release-dir> <revision>
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[2];
const REVISION = process.argv[3];
if (!ROOT || !REVISION || !/^[0-9a-f]{7,40}$/i.test(REVISION)) {
  console.error("usage: stamp-asset-revision.mjs <release-dir> <git-sha>");
  process.exit(2);
}

// Prefer short bust token; full SHA also fine if passed.
const V = REVISION.length >= 12 ? REVISION.slice(0, 12) : REVISION;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function isLocalAssetSpec(spec) {
  if (!spec) return false;
  if (/^(https?:|data:|blob:|\/\/)/i.test(spec)) return false;
  const pathPart = spec.split("?")[0].split("#")[0];
  return /\.(js|mjs|css)$/i.test(pathPart);
}

function alreadyStamped(spec) {
  return /[?&]v=/.test(spec);
}

function stampSpec(spec) {
  if (!isLocalAssetSpec(spec) || alreadyStamped(spec)) return spec;
  const hashIdx = spec.indexOf("#");
  const hash = hashIdx >= 0 ? spec.slice(hashIdx) : "";
  const withoutHash = hashIdx >= 0 ? spec.slice(0, hashIdx) : spec;
  const sep = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${sep}v=${V}${hash}`;
}


function stampHtml(text) {
  // href / src attributes for local css/js
  let out = text.replace(
    /\b(href|src)=(["'])([^"']+)\2/gi,
    (full, attr, q, url) => {
      if (!isLocalAssetSpec(url)) return full;
      return `${attr}=${q}${stampSpec(url)}${q}`;
    }
  );
  // inline ESM: from '...'; import('...')
  out = out.replace(
    /\bfrom\s*(['"])([^'"]+)\1/g,
    (full, q, url) => `from ${q}${stampSpec(url)}${q}`
  );
  out = out.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (full, q, url) => `import(${q}${stampSpec(url)}${q})`
  );
  return out;
}

function stampJs(text) {
  let out = text.replace(
    /\bfrom\s*(['"])([^'"]+)\1/g,
    (full, q, url) => `from ${q}${stampSpec(url)}${q}`
  );
  out = out.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (full, q, url) => `import(${q}${stampSpec(url)}${q})`
  );
  // new URL('./worker.js', import.meta.url) — query must be on the relative URL
  out = out.replace(
    /new\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (full, q, url) => `new URL(${q}${stampSpec(url)}${q}, import.meta.url)`
  );
  return out;
}

function stampCss(text) {
  // @import url('base.css');  or  @import 'base.css';
  return text.replace(
    /@import\s+url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (full, q, url) => {
      const pathPart = url.split("?")[0];
      if (!/\.css$/i.test(pathPart)) return full;
      if (/^(https?:|data:|\/\/)/i.test(url) || alreadyStamped(url)) return full;
      return full.replace(url, stampSpec(url));
    }
  ).replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (full, q, url) => {
      const pathPart = url.split("?")[0];
      if (!/\.css$/i.test(pathPart)) return full;
      if (/^(https?:|data:|\/\/)/i.test(url) || alreadyStamped(url)) return full;
      return `@import ${q}${stampSpec(url)}${q}`;
    }
  );
}

let changedFiles = 0;
const files = walk(ROOT);

for (const file of files) {
  if (file.endsWith(".gz") || file.endsWith(".br")) continue;
  const ext = extname(file).toLowerCase();
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let next = text;
  if (ext === ".html") next = stampHtml(text);
  else if (ext === ".js" || ext === ".mjs") next = stampJs(text);
  else if (ext === ".css") next = stampCss(text);
  else continue;

  if (next !== text) {
    writeFileSync(file, next);
    changedFiles++;
  }
}

console.log(`stamp-asset-revision: v=${V} updated ${changedFiles} files under ${ROOT}`);
