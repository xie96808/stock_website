#!/usr/bin/env node
// Fingerprint js/css (and optionally HTML-referenced images) by content hash in
// the filename for immutable long-cache. Runs on the release tree only.
//
// Algorithm (dependency-aware so ESM graphs stay cache-correct):
//   1. Collect assets under the release dir
//   2. Topo-sort on STATIC deps only (from / new URL / @import) — dynamic
//      import() is excluded so soft cycles like auth↔leaderboard do not scramble
//      order (that bug left bare ./result.js in game.js on prod Wave A).
//   3. Rewrite static refs → hash → rename, leaves before roots
//   4. Final in-place rewrite of dynamic import() (no re-hash; avoids oscillation)
//   5. Fail closed if any bare unhashed local .js import remains
//   6. Rewrite HTML entry points (index.html not renamed; stays bustable)
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

/** Static ESM edges only — dynamic import() must not create topo cycles. */
function collectStaticSpecsFromJs(text) {
  const specs = [];
  const push = (url) => {
    if (isLocalSpec(url, ASSET_EXT_RE)) specs.push(url);
  };
  text.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (_, __, url) => {
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

function listBareLocalJsImports(root, fromFile, text) {
  const bare = [];
  for (const spec of collectSpecsFromJs(text)) {
    if (!isLocalSpec(spec, /\.(js|mjs)$/i)) continue;
    const name = basename(stripQueryHash(spec).pathPart);
    if (HASHED_NAME_RE.test(name)) continue;
    const resolved = resolveLocal(root, fromFile, spec);
    if (!resolved) continue;
    bare.push({ spec, abs: resolved.abs });
  }
  return bare;
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

function rewriteJs(root, fromFile, text, mapping, { includeDynamic = true } = {}) {
  let out = text.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (full, q, url) => {
    return `from ${q}${rewriteSpec(root, fromFile, url, mapping)}${q}`;
  });
  if (includeDynamic) {
    out = out.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (full, q, url) => {
      return `import(${q}${rewriteSpec(root, fromFile, url, mapping)}${q})`;
    });
  }
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
      ext === ".css" ? collectSpecsFromCss(text) : collectStaticSpecsFromJs(text);
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
  const leftovers = [];
  for (const f of textAssets.keys()) {
    if (!order.includes(f)) leftovers.push(f);
  }
  // Static cycles are unsupported for content-hash filenames (hash would
  // oscillate). Fail closed rather than ship bare imports.
  if (leftovers.length) {
    throw new Error(
      "fingerprint-assets: static import cycle (content-hash cannot converge):\n  " +
        leftovers
          .slice(0, 20)
          .map((f) => relative(rootResolved, f))
          .join("\n  ")
    );
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
        : rewriteJs(rootResolved, file, text, mapping, { includeDynamic: false });

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

  // Final pass: rewrite dynamic import() in place (no re-hash).
  for (const curAbs of [...new Set(mapping.values())]) {
    if (!existsSync(curAbs)) continue;
    const ext = extname(curAbs).toLowerCase();
    if (ext !== ".js" && ext !== ".mjs") continue;
    const prev = readFileSync(curAbs, "utf8");
    const next = rewriteJs(rootResolved, curAbs, prev, mapping, {
      includeDynamic: true,
    });
    if (next !== prev) writeFileSync(curAbs, next);
  }

  const bareProblems = [];
  for (const curAbs of new Set(mapping.values())) {
    if (!existsSync(curAbs)) continue;
    const ext = extname(curAbs).toLowerCase();
    if (ext !== ".js" && ext !== ".mjs") continue;
    const body = readFileSync(curAbs, "utf8");
    for (const { spec, abs } of listBareLocalJsImports(rootResolved, curAbs, body)) {
      if (mapping.has(abs) || existsSync(abs)) {
        bareProblems.push(`${relative(rootResolved, curAbs)} -> ${spec}`);
      }
    }
  }
  if (bareProblems.length) {
    throw new Error(
      "fingerprint-assets: bare unhashed JS imports remain:\n  " +
        bareProblems.slice(0, 20).join("\n  ")
    );
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
