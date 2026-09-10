import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeDatasetSha,
  versionedPackUrl,
  idbKeyForPack,
  normalizePackMeta,
  LEGACY_IDB_KEY,
  PACK_FALLBACK_URL,
} from '../js/pack-url.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('normalizeDatasetSha / versionedPackUrl / idbKeyForPack', () => {
  const sha = 'a'.repeat(64);
  assert.equal(normalizeDatasetSha(sha.toUpperCase()), sha);
  assert.equal(normalizeDatasetSha('nope'), null);
  assert.equal(versionedPackUrl(sha), `data/stocks_data.${sha}.json`);
  assert.equal(versionedPackUrl('short'), null);
  assert.equal(idbKeyForPack(sha), sha);
  assert.equal(idbKeyForPack(null), LEGACY_IDB_KEY);
});

test('normalizePackMeta fills defaults and rejects bad sha', () => {
  const sha = 'b'.repeat(64);
  const meta = normalizePackMeta({ datasetSha: sha });
  assert.deepEqual(meta, {
    datasetSha: sha,
    datasetVersion: sha,
    packUrl: `data/stocks_data.${sha}.json`,
    fallbackUrl: PACK_FALLBACK_URL,
    fallbackJsUrl: 'data/stocks_data.js',
  });
  assert.equal(normalizePackMeta({ datasetVersion: 'abc' }), null);
  assert.equal(normalizePackMeta(null), null);
});

test('emit-versioned-pack writes hardlink twin + pack-meta + version.json fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-pack-'));
  try {
    mkdirSync(join(dir, 'data'));
    const body = JSON.stringify([{ code: '600000', name: 'T', kline: [] }]);
    writeFileSync(join(dir, 'data', 'stocks_data.json'), body);
    writeFileSync(join(dir, 'version.json'), JSON.stringify({ revision: 'x'.repeat(40), builtAt: 't' }));
    const expectedSha = createHash('sha256').update(body).digest('hex');

    const script = join(ROOT, 'deploy', 'emit-versioned-pack.mjs');
    const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const versioned = join(dir, 'data', `stocks_data.${expectedSha}.json`);
    assert.ok(existsSync(versioned));
    assert.equal(readFileSync(versioned, 'utf8'), body);

    const meta = JSON.parse(readFileSync(join(dir, 'data', 'pack-meta.json'), 'utf8'));
    assert.equal(meta.datasetSha, expectedSha);
    assert.equal(meta.datasetVersion, expectedSha);
    assert.equal(meta.packUrl, `data/stocks_data.${expectedSha}.json`);
    assert.equal(meta.fallbackUrl, 'data/stocks_data.json');

    const version = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8'));
    assert.equal(version.datasetSha, expectedSha);
    assert.equal(version.packUrl, meta.packUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
