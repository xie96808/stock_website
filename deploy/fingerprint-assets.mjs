#!/usr/bin/env node
// Fingerprint js/css (and optionally HTML-referenced images) by content hash in
// the filename for immutable long-cache. Runs on the release tree only.
//
// Algorithm (dependency-aware so ESM graphs stay cache-correct):
//   1. Collect assets under the release dir
//   2. Parse static local deps (from / import() / new URL / @import / HTML href|src)
//   3. Topo-process leaves -> roots: rewrite refs to already-fingerprinted deps,
//      hash rewritten bytes, rename file to name.<8-12hex>.ext
//   4. Rewrite HTML entry points (index.html not renamed; stays bustable)
//
// Skips remote/data/blob URLs. Does not double-hash already-fingerprinted names.
// Local dev without packaging keeps unhashed sources.
//
// Usage: node deploy/fingerprint-assets.mjs <release-dir>
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join, dirname, basename, extname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const HASH_LEN = 10;
/** Matches name.<8-12 hex>.(js|mjs|css|png|…) — already fingerprinted. */
const HASHED_NAME_RE = /^(.+)\.([a-f0-9]{8,12})(\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico))$/i;
const ASSET_EXT_RE = /\.(js|mjs|css)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/i;

export function contentHash(buf, len = HASH_LEN) {
  return createHash("sha256").update(buf).digest("hex").slice(0, len);
}

export function isAlreadyHashedName(fileName) {
  return HASHED_NAME_RE.test(basename(fileName));
}

export function insertHashBeforeExt(fileName, hash) {
  const base = basename(fileName);
  if (HASHED_NAME_RE.test(base)) return base;
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  return `${stem}.${hash}${ext}`;
}

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

function stripQueryHash(spec) {
  const hashIdx = spec.indexOf("#");
  const hash = hashIdx >= 0 ? spec.slice(hashIdx) : "";
  const withoutHash = hashIdx >= 0 ? spec.slice(0, hashIdx) : spec;
  const qIdx = withoutHash.indexOf("?");
  const pathPart = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash;
  return { pathPart, hash };
}

function isLocalSpec(spec, extRe) {
  if (!spec) return false;
  if (/^(https?:|data:|blob:|\/\/)/i.test(spec)) return false;
  const { pathPart } = stripQueryHash(spec);
  return extRe.test(pathPart);
}

/** Resolve a local URL spec relative to `fromFile` within `root`. */
export function resolveLocal(root, fromFile, spec) {
  const { pathPart, hash } = stripQueryHash(spec);
  let abs;
  if (pathPart.startsWith("/")) {
    abs = resolve(root, "." + pathPart);
  } else {
    abs = resolve(dirname(fromFile), pathPart);
  }
  const rootResolved = resolve(root);
  if (!abs.startsWith(rootResolved + sep) && abs !== rootResolved) return null;
  return { abs, hash };
}

function relUrl(fromFile, targetAbs) {
  let rel = relative(dirname(fromFile), targetAbs);
  if (!rel.startsWith(".") && !rel.startsWith("/")) rel = "./" + rel;
  return rel.split(sep).join("/");
}

function collectSpecsFromJs(text) {
  const specs = [];
  const push = (url) => {
    if (isLocalSpec(url, ASSET_EXT_RE)) specs.push(url);
  };
  text.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (_, __, url) => {
    push(url);
    return _;
  });
  text.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (_, __, url) => {
    push(url);
    return _;
  });
  text.replace(
    /new\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (_, __, url) => {
      push(url);
      return _;
    }
  );
  return specs;
}

function collectSpecsFromCss(text) {
  const specs = [];
  const push = (url) => {
    if (isLocalSpec(url, /\.css$/i)) specs.push(url);
  };
  text.replace(/@import\s+url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_, __, url) => {
    push(url);
    return _;
  });
  text.replace(/@import\s+(['"])([^'"]+)\1/gi, (_, __, url) => {
    push(url);
    return _;
  });
  return specs;
}

function collectSpecsFromHtml(text, { images = false } = {}) {
  const specs = [];
  const extRe = images
    ? /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico)$/i
    : ASSET_EXT_RE;
  text.replace(/\b(href|src)=(["'])([^"']+)\2/gi, (_, __, ___, url) => {
    if (isLocalSpec(url, extRe)) specs.push(url);
    return _;
  });
  text.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (_, __, url) => {
    if (isLocalSpec(url, ASSET_EXT_RE)) specs.push(url);
    return _;
  });
  text.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (_, __, url) => {
    if (isLocalSpec(url, ASSET_EXT_RE)) specs.push(url);
    return _;
  });
  return specs;
}

function rewriteSpec(root, fromFile, spec, mapping) {
  if (!isLocalSpec(spec, /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico)$/i)) {
    return spec;
  }
  const resolved = resolveLocal(root, fromFile, spec);
  if (!resolved) return spec;
  const newAbs = mapping.get(resolved.abs);
  if (!newAbs) {
    const { pathPart, hash } = stripQueryHash(spec);
    if (spec.includes("?v=")) return pathPart + hash;
    return spec;
  }
  const { pathPart } = stripQueryHash(spec);
  let newRel;
  if (pathPart.startsWith("/")) {
    newRel = "/" + relative(root, newAbs).split(sep).join("/");
  } else if (!pathPart.startsWith(".")) {
    newRel = relative(dirname(fromFile), newAbs).split(sep).join("/");
  } else {
    newRel = relUrl(fromFile, newAbs);
  }
  return newRel + resolved.hash;
}

function rewriteJs(root, fromFile, text, mapping) {
  let out = text.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (full, q, url) => {
    return `from ${q}${rewriteSpec(root, fromFile, url, mapping)}${q}`;
  });
  out = out.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (full, q, url) => {
    return `import(${q}${rewriteSpec(root, fromFile, url, mapping)}${q})`;
  });
  out = out.replace(
    /new\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (full, q, url) =>
      `new URL(${q}${rewriteSpec(root, fromFile, url, mapping)}${q}, import.meta.url)`
  );
  return out;
}

function rewriteCss(root, fromFile, text, mapping) {
  return text
    .replace(/@import\s+url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q, url) => {
      if (!isLocalSpec(url, /\.css$/i)) return full;
      const next = rewriteSpec(root, fromFile, url, mapping);
      return full.replace(url, next);
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (full, q, url) => {
      if (!isLocalSpec(url, /\.css$/i)) return full;
      return `@import ${q}${rewriteSpec(root, fromFile, url, mapping)}${q}`;
    });
}

function rewriteHtml(root, fromFile, text, mapping) {
  let out = text.replace(/\b(href|src)=(["'])([^"']+)\2/gi, (full, attr, q, url) => {
    if (!isLocalSpec(url, /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico)$/i)) {
      return full;
    }
    return `${attr}=${q}${rewriteSpec(root, fromFile, url, mapping)}${q}`;
  });
  out = out.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (full, q, url) => {
    return `from ${q}${rewriteSpec(root, fromFile, url, mapping)}${q}`;
  });
  out = out.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (full, q, url) => {
    return `import(${q}${rewriteSpec(root, fromFile, url, mapping)}${q})`;
  });
  return out;
}

/**
 * Fingerprint assets in-place under `root`.
 * @returns {{ renamed: number, rewrittenHtml: number, mapping: Map<string,string> }}
 */
export function fingerprintRelease(root, { fingerprintImages = true } = {}) {
  const rootResolved = resolve(root);
  const allFiles = walk(rootResolved).filter(
    (p) => !p.endsWith(".gz") && !p.endsWith(".br")
  );

  const textAssets = new Map();
  const imageAssets = new Set();
  const htmlFiles = [];

  for (const file of allFiles) {
    const ext = extname(file).toLowerCase();
    if (ext === ".html") {
      htmlFiles.push(file);
      continue;
    }
    if (ASSET_EXT_RE.test(ext)) {
      textAssets.set(file, readFileSync(file, "utf8"));
    } else if (fingerprintImages && IMAGE_EXT_RE.test(ext)) {
      imageAssets.add(file);
    }
  }

  const referencedImages = new Set();
  if (fingerprintImages) {
    for (const html of htmlFiles) {
      const text = readFileSync(html, "utf8");
      for (const spec of collectSpecsFromHtml(text, { images: true })) {
        if (!isLocalSpec(spec, IMAGE_EXT_RE)) continue;
        const r = resolveLocal(rootResolved, html, spec);
        if (r && imageAssets.has(r.abs)) referencedImages.add(r.abs);
      }
    }
  }

  const deps = new Map();
  for (const [file, text] of textAssets) {
    const ext = extname(file).toLowerCase();
    const specs =
      ext === ".css" ? collectSpecsFromCss(text) : collectSpecsFromJs(text);
    const resolved = [];
    for (const spec of specs) {
      const r = resolveLocal(rootResolved, file, spec);
      if (r && textAssets.has(r.abs)) resolved.push(r.abs);
    }
    deps.set(file, resolved);
  }

  const indeg = new Map();
  for (const f of textAssets.keys()) {
    indeg.set(f, (deps.get(f) || []).length);
  }
  const dependents = new Map();
  for (const [f, ds] of deps) {
    for (const d of ds) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(f);
    }
  }
  const queue = [];
  for (const [f, n] of indeg) {
    if (n === 0) queue.push(f);
  }
  const order = [];
  while (queue.length) {
    const f = queue.shift();
    order.push(f);
    for (const parent of dependents.get(f) || []) {
      indeg.set(parent, indeg.get(parent) - 1);
      if (indeg.get(parent) === 0) queue.push(parent);
    }
  }
  for (const f of textAssets.keys()) {
    if (!order.includes(f)) order.push(f);
  }

  const mapping = new Map();

  for (const img of referencedImages) {
    if (isAlreadyHashedName(img)) {
      mapping.set(img, img);
      continue;
    }
    const buf = readFileSync(img);
    const hash = contentHash(buf);
    const newName = insertHashBeforeExt(img, hash);
    const newAbs = join(dirname(img), newName);
    if (newAbs !== img) {
      if (existsSync(newAbs)) unlinkSync(newAbs);
      renameSync(img, newAbs);
    }
    mapping.set(img, newAbs);
  }

  let renamed = 0;
  for (const file of order) {
    let text = textAssets.get(file);
    const ext = extname(file).toLowerCase();
    text =
      ext === ".css"
        ? rewriteCss(rootResolved, file, text, mapping)
        : rewriteJs(rootResolved, file, text, mapping);

    if (isAlreadyHashedName(file)) {
      if (text !== textAssets.get(file)) writeFileSync(file, text);
      mapping.set(file, file);
      textAssets.set(file, text);
      continue;
    }

    const hash = contentHash(Buffer.from(text, "utf8"));
    const newName = insertHashBeforeExt(file, hash);
    const newAbs = join(dirname(file), newName);
    writeFileSync(file, text);
    if (newAbs !== file) {
      if (existsSync(newAbs)) unlinkSync(newAbs);
      renameSync(file, newAbs);
      renamed++;
    }
    mapping.set(file, newAbs);
    textAssets.delete(file);
    textAssets.set(newAbs, text);
  }

  let rewrittenHtml = 0;
  for (const html of htmlFiles) {
    const text = readFileSync(html, "utf8");
    const next = rewriteHtml(rootResolved, html, text, mapping);
    if (next !== text) {
      writeFileSync(html, next);
      rewrittenHtml++;
    }
  }

  return { renamed, rewrittenHtml, mapping };
}

function main() {
  const ROOT = process.argv[2];
  if (!ROOT) {
    console.error("usage: fingerprint-assets.mjs <release-dir>");
    process.exit(2);
  }
  if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
    console.error(`not a directory: ${ROOT}`);
    process.exit(2);
  }
  const { renamed, rewrittenHtml, mapping } = fingerprintRelease(ROOT);
  console.log(
    `fingerprint-assets: renamed ${renamed} assets, rewrote ${rewrittenHtml} html, map size ${mapping.size} under ${ROOT}`
  );
}

const isCli =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) main();
