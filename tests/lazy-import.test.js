import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { importWithRetry, _resetLazyImportCache } from '../js/lazy-import.js';

function tmpModule(body) {
  const dir = mkdtempSync(join(tmpdir(), 'lazy-import-'));
  const file = join(dir, 'm.mjs');
  writeFileSync(file, body);
  return pathToFileURL(file).href;
}

test('normal path: literal import is used, urlOf is never called, module is cached', async () => {
  _resetLazyImportCache();
  let literalCalls = 0;
  let urlCalls = 0;
  const m = { default: 1 };
  const load = () => importWithRetry('a', async () => { literalCalls++; return m; }, () => { urlCalls++; return 'x'; });
  assert.equal(await load(), m);
  assert.equal(await load(), m);
  assert.equal(literalCalls, 1);
  assert.equal(urlCalls, 0);
});

test('RETRY-01: after the literal import rejects, retries once with a cache-busting ?r= URL', async () => {
  _resetLazyImportCache();
  const url = tmpModule('export default "ok";');
  let literalCalls = 0;
  const seen = [];
  const load = () => importWithRetry('b', async () => { literalCalls++; throw new TypeError('Failed to fetch dynamically imported module'); }, () => { seen.push(url); return url; });
  const mod = await load();
  assert.equal(mod.default, 'ok');
  assert.equal(literalCalls, 1);
  // second tap: already loaded, no further import at all
  assert.equal((await load()).default, 'ok');
  assert.equal(literalCalls, 1);
});

test('RETRY-01: the retry URL carries a fresh r=<timestamp> (& when a query already exists)', async () => {
  _resetLazyImportCache();
  const t0 = Date.now();
  // wrap urlOf to read what importWithRetry appended by importing a module that echoes import.meta.url
  const echoUrl = tmpModule('export default import.meta.url;');
  const mod = await importWithRetry('c', async () => { throw new Error('boom'); }, () => echoUrl);
  const used = mod.default;
  assert.match(used, /\?r=\d{13}$/);
  assert.ok(Number(used.split('?r=')[1]) >= t0);
  _resetLazyImportCache();
  const q = tmpModule('export default import.meta.url;') + '?v=1';
  const mod2 = await importWithRetry('d', async () => { throw new Error('boom'); }, () => q);
  assert.match(mod2.default, /\?v=1&r=\d{13}$/);
});

test('RETRY-01: if the cache-busted import also fails, the error propagates and nothing is cached', async () => {
  _resetLazyImportCache();
  let n = 0;
  const bad = pathToFileURL(join(tmpdir(), 'definitely-missing-' + Date.now() + '.mjs')).href;
  await assert.rejects(importWithRetry('e', async () => { n++; throw new Error('first'); }, () => bad));
  // network back: next tap tries the literal again and now succeeds
  const ok = { default: 'back' };
  const mod = await importWithRetry('e', async () => { n++; return ok; }, () => bad);
  assert.equal(mod, ok);
  assert.equal(n, 2);
});
