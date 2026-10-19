import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync, cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LW_ASSET_V } from '../js/lucky-wheel-pure.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets', 'lucky-wheel');
const CSS = readFileSync(join(ROOT, 'css', 'lucky-wheel.css'), 'utf8');
const JS = readFileSync(join(ROOT, 'js', 'lucky-wheel.js'), 'utf8');
const PURE = readFileSync(join(ROOT, 'js', 'lucky-wheel-pure.js'), 'utf8');

/** Every asset basename referenced by the wheel client: css url(), imgHtml("x"), url2x("x"), PRELOAD list, artFile() outputs, fx pack. */
function referencedNames() {
  const names = new Set();
  for (const m of CSS.matchAll(/assets\/lucky-wheel\/([a-z0-9-]+)(?:@2x)?\.webp/g)) names.add(m[1]);
  for (const m of JS.matchAll(/(?:imgHtml|url2x|url)\("([a-z0-9-]+)"/g)) names.add(m[1]);
  const pre = /const PRELOAD = \[([\s\S]*?)\];/.exec(JS);
  for (const m of (pre ? pre[1] : '').matchAll(/"([a-z0-9-]+)"/g)) names.add(m[1]);
  for (const m of PURE.matchAll(/"(lw-prize-[a-z0-9-]+)"/g)) names.add(m[1]);
  for (let i = 1; i <= 5; i++) names.add(`lw-prize-${i}`);
  for (let i = 1; i <= 6; i++) names.add(`lw-confetti-${i}`);
  return [...names];
}

test('every wheel asset referenced by css/js exists as .webp and @2x.webp', () => {
  const names = referencedNames();
  assert.ok(names.length >= 25, `found ${names.length} names`);
  for (const n of names) {
    assert.ok(existsSync(join(ASSETS, `${n}.webp`)), `${n}.webp missing`);
    assert.ok(existsSync(join(ASSETS, `${n}@2x.webp`)), `${n}@2x.webp missing`);
  }
  assert.ok(existsSync(join(ASSETS, 'MANIFEST.md')));
});

test('all css asset urls carry the same ?v= token as LW_ASSET_V (cache bust in one place)', () => {
  const urls = [...CSS.matchAll(/assets\/lucky-wheel\/[a-z0-9@-]+\.webp(\?v=[0-9a-z]+)?/g)];
  assert.ok(urls.length > 20);
  for (const m of urls) assert.equal(m[1], `?v=${LW_ASSET_V}`, m[0]);
  assert.match(JS, /\?v=\$\{V\}/, 'js builds urls with the token');
  assert.match(JS, /const V = P\.LW_ASSET_V/);
});

test('shipped wheel art stays inside the size budget (referenced @2x webp)', () => {
  let total = 0;
  for (const n of referencedNames()) {
    const f = join(ASSETS, `${n}@2x.webp`);
    if (existsSync(f)) total += statSync(f).size;
  }
  assert.ok(total < 420 * 1024, `referenced @2x webp total ${(total / 1024).toFixed(0)} KB`);
});

test('index.html links css/lucky-wheel.css after jiu-coin.css', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('css/jiu-coin.css');
  const b = html.indexOf('css/lucky-wheel.css');
  assert.ok(a > 0 && b > a);
});

test('css: no grain textures, no baked-in text, label ink + ribbon outline present', () => {
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /noise|grain|speckle|feTurbulence/i);
  assert.match(CSS, /--lw-label-ink:\s*#26211d/);
  assert.match(CSS, /\.lw-title[\s\S]{0,700}text-shadow:\s*var\(--lw-outline\)/);
  assert.match(CSS, /prefers-reduced-motion: reduce/);
  assert.match(CSS, /conic-gradient\(from -22\.5deg/);
});

test('js: no alert()/confirm()/prompt(), all error paths go through toast/inline UI', () => {
  assert.doesNotMatch(JS, /\b(alert|confirm|prompt)\s*\(/);
  assert.match(JS, /Idempotency-Key/);
});

test('fingerprint: css/js hashed + refs rewritten, wheel images under assets/ stay at stable (?v=) URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-fp-'));
  try {
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    cpSync(ASSETS, join(dir, 'assets', 'lucky-wheel'), { recursive: true });
    for (const f of ['lucky-wheel.js', 'lucky-wheel-pure.js']) writeFileSync(join(dir, 'js', f), readFileSync(join(ROOT, 'js', f)));
    // lucky-wheel.js imports auth.js / controls.js: minimal stand-ins keep the graph self-contained
    writeFileSync(join(dir, 'js', 'auth.js'), 'export const api=1,getAuthState=1,showToast=1;\n');
    writeFileSync(join(dir, 'js', 'controls.js'), 'export const openCtlOverlay=1,closeCtlOverlay=1;\n');
    writeFileSync(join(dir, 'js', 'jiu-coin.js'), "export async function open(){ return import('./lucky-wheel.js'); }\n");
    writeFileSync(join(dir, 'css', 'lucky-wheel.css'), CSS);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>\n<link rel="stylesheet" href="css/lucky-wheel.css">\n<script type="module">import { open } from \'./js/jiu-coin.js\';</script>\n');
    const before = readdirSync(join(dir, 'assets', 'lucky-wheel')).sort();
    const r = spawnSync(process.execPath, [join(ROOT, 'deploy', 'fingerprint-assets.mjs'), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const jsNames = readdirSync(join(dir, 'js'));
    const lw = jsNames.find((n) => /^lucky-wheel\.[a-f0-9]{10}\.js$/.test(n));
    const pure = jsNames.find((n) => /^lucky-wheel-pure\.[a-f0-9]{10}\.js$/.test(n));
    const jc = jsNames.find((n) => /^jiu-coin\.[a-f0-9]{10}\.js$/.test(n));
    assert.ok(lw && pure && jc, jsNames.join(','));
    assert.match(readFileSync(join(dir, 'js', lw), 'utf8'), new RegExp(`from "\\./${pure.replace('.', '\\.')}"`));
    assert.match(readFileSync(join(dir, 'js', jc), 'utf8'), new RegExp(`import\\('\\./${lw.replace('.', '\\.')}'\\)`), 'lazy import() specifier rewritten');
    const cssName = readdirSync(join(dir, 'css')).find((n) => /^lucky-wheel\.[a-f0-9]{10}\.css$/.test(n));
    assert.ok(cssName);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), new RegExp(`href="css/${cssName.replace('.', '\\.')}"`));
    // images under assets/ are not renamed (JS assigns them by string) and the css keeps pointing at them
    assert.deepEqual(readdirSync(join(dir, 'assets', 'lucky-wheel')).sort(), before);
    const cssOut = readFileSync(join(dir, 'css', cssName), 'utf8');
    assert.match(cssOut, /assets\/lucky-wheel\/lw-go-default@2x\.webp\?v=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
