#!/usr/bin/env node
// Fingerprint js/css (and optionally HTML-referenced images) by content hash in
// the filename for immutable long-cache. Runs on the release tree only.
//
// Algorithm (dependency-aware so ESM graphs stay cache-correct, including cycles):
//   1. Collect assets under the release dir
//   2. Fingerprint HTML-referenced images (one-shot rename)
//   3. Iterative fixed-point on JS/CSS in memory:
//        rewrite imports via current originalAbs→outputAbs mapping,
//        re-hash → desired name.<hash>.ext; repeat until mapping stable
//      True static cycles (A↔B) cannot converge name===sha(bytes); after max
//      iters we freeze the mapping and do one final rewrite so imports still
//      point at hashed paths, then write once.
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
const MAX_FP_ITERS = 20;

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

function rewriteTextAsset(root, file, origText, mapping) {
  const ext = extname(file).toLowerCase();
  return ext === ".css"
    ? rewriteCss(root, file, origText, mapping)
    : rewriteJs(root, file, origText, mapping);
}

/**
 * Fingerprint assets in-place under `root`.
 *
 * JS/CSS use an iterative fixed-point over the import graph so cycles still
 * get fully hashed local specs (topo-order alone leaves unhashed refs when A↔B).
 * Images are one-shot renamed first; HTML is rewritten once at the end.
 *
 * @returns {{ renamed: number, rewrittenHtml: number, mapping: Map<string,string> }}
 */
export function fingerprintRelease(root, { fingerprintImages = true } = {}) {
  const rootResolved = resolve(root);
  const allFiles = walk(rootResolved).filter(
    (p) => !p.endsWith(".gz") && !p.endsWith(".br")
  );

  /** @type {Map<string, string>} originalAbs -> source text */
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

  /** originalAbs -> current/desired outputAbs (identity until hashed). */
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

  for (const file of textAssets.keys()) {
    mapping.set(file, file);
  }

  for (let iter = 0; iter < MAX_FP_ITERS; iter++) {
    let changed = false;
    for (const [file, origText] of textAssets) {
      if (isAlreadyHashedName(file)) {
        if (mapping.get(file) !== file) {
          mapping.set(file, file);
          changed = true;
        }
        continue;
      }
      const text = rewriteTextAsset(rootResolved, file, origText, mapping);
      const hash = contentHash(Buffer.from(text, "utf8"));
      const newAbs = join(dirname(file), insertHashBeforeExt(file, hash));
      if (mapping.get(file) !== newAbs) {
        mapping.set(file, newAbs);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Final rewrite against frozen/stable mapping so import specs match out paths.
  /** @type {Map<string, string>} */
  const rewrittenTexts = new Map();
  for (const [file, origText] of textAssets) {
    rewrittenTexts.set(
      file,
      rewriteTextAsset(rootResolved, file, origText, mapping)
    );
  }

  let renamed = 0;
  for (const [file, text] of textAssets) {
    const outAbs = mapping.get(file);
    const rewritten = rewrittenTexts.get(file) ?? text;

    if (isAlreadyHashedName(file)) {
      if (rewritten !== text) writeFileSync(file, rewritten);
      continue;
    }

    if (outAbs === file) {
      if (rewritten !== text) writeFileSync(file, rewritten);
      continue;
    }

    if (existsSync(outAbs)) unlinkSync(outAbs);
    writeFileSync(outAbs, rewritten);
    if (existsSync(file)) unlinkSync(file);
    renamed++;
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
