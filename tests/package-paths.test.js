// Guard: every top-level directory that shipped CSS / HTML points at with a
// relative url(...) / src= must be copied by deploy/package-production.sh,
// otherwise production 404s it (css/home-arcade.css → ../fonts/*.woff2 did).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function packagedPaths() {
  const sh = readFileSync(join(ROOT, 'deploy', 'package-production.sh'), 'utf8');
  const m = sh.match(/for path in ([^;]+); do/);
  assert.ok(m, 'package-production.sh path list not found');
  return new Set(m[1].trim().split(/\s+/));
}

function cssTopDirs() {
  const dirs = new Map();
  const cssDir = join(ROOT, 'css');
  for (const f of readdirSync(cssDir).filter((n) => n.endsWith('.css'))) {
    const src = readFileSync(join(cssDir, f), 'utf8');
    for (const [, raw] of src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      if (/^(data:|https?:|\/\/|#)/.test(raw)) continue;
      // css/*.css → "../x/y" resolves to repo-root x/
      const rel = raw.startsWith('../') ? raw.slice(3) : `css/${raw}`;
      const top = rel.split(/[/?#]/)[0];
      if (!dirs.has(top)) dirs.set(top, `${f}: ${raw}`);
    }
  }
  return dirs;
}

test('every directory referenced from css url() is packaged for production', () => {
  const pkg = packagedPaths();
  for (const [top, where] of cssTopDirs()) {
    assert.ok(pkg.has(top), `${where} → top-level "${top}" is not in package-production.sh`);
  }
});

test('fonts used by @font-face exist and are packaged', () => {
  const pkg = packagedPaths();
  assert.ok(pkg.has('fonts'));
  for (const f of ['noto-sc-panel.woff2', 'roboto-num.woff2']) {
    assert.ok(existsSync(join(ROOT, 'fonts', f)), `fonts/${f} missing in repo`);
  }
});
