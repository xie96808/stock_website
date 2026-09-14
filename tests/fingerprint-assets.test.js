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
  readdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  contentHash,
  insertHashBeforeExt,
  isAlreadyHashedName,
  fingerprintRelease,
} from '../deploy/fingerprint-assets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'deploy', 'fingerprint-assets.mjs');

function sha10(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 10);
}

test('contentHash / insertHashBeforeExt / isAlreadyHashedName helpers', () => {
  assert.equal(contentHash(Buffer.from('abc'), 10).length, 10);
  assert.equal(insertHashBeforeExt('foo.js', 'aabbccddee'), 'foo.aabbccddee.js');
  assert.equal(insertHashBeforeExt('foo.aabbccddee.js', 'ffff'), 'foo.aabbccddee.js');
  assert.ok(isAlreadyHashedName('bar.0123456789ab.css'));
  assert.ok(!isAlreadyHashedName('bar.css'));
});

test('fingerprint: stable hash, refs rewritten, no double-hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-fp-'));
  try {
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    mkdirSync(join(dir, 'images'));

    const leafBody = 'export const X = 1;\n';
    const midBody = "import { X } from './leaf.js';\nexport const Y = X;\n";
    const entryBody =
      "import { Y } from './mid.js';\nnew URL('./leaf.js', import.meta.url);\n";
    const cssLeaf = 'body{color:red}\n';
    const cssMain = "@import url('leaf.css');\nhtml{margin:0}\n";

    writeFileSync(join(dir, 'js', 'leaf.js'), leafBody);
    writeFileSync(join(dir, 'js', 'mid.js'), midBody);
    writeFileSync(join(dir, 'js', 'entry.js'), entryBody);
    writeFileSync(join(dir, 'css', 'leaf.css'), cssLeaf);
    writeFileSync(join(dir, 'css', 'main.css'), cssMain);
    writeFileSync(join(dir, 'images', 'icon.png'), Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]));
    // Already-hashed asset must not be double-hashed
    const preHash = 'aabbccddee';
    writeFileSync(join(dir, 'js', `stable.${preHash}.js`), 'export const S = 1;\n');

    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html>
<link rel="stylesheet" href="css/main.css">
<link rel="icon" href="/images/icon.png?v=old">
<script type="module">
  import { Y } from './js/entry.js';
  import { S } from './js/stable.${preHash}.js';
</script>
`
    );

    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const jsNames = readdirSync(join(dir, 'js')).sort();
    assert.ok(!jsNames.includes('leaf.js'), 'unhashed leaf removed');
    assert.ok(!jsNames.includes('mid.js'));
    assert.ok(!jsNames.includes('entry.js'));
    assert.ok(jsNames.includes(`stable.${preHash}.js`), 'already-hashed kept');
    assert.equal(jsNames.filter((n) => n.startsWith('stable.')).length, 1);

    const leafHashed = jsNames.find((n) => n.startsWith('leaf.') && n.endsWith('.js'));
    const midHashed = jsNames.find((n) => n.startsWith('mid.') && n.endsWith('.js'));
    const entryHashed = jsNames.find((n) => n.startsWith('entry.') && n.endsWith('.js'));
    assert.ok(leafHashed && midHashed && entryHashed);

    // Leaf hash is content-only (no deps rewritten)
    assert.equal(leafHashed, `leaf.${sha10(leafBody)}.js`);

    const midText = readFileSync(join(dir, 'js', midHashed), 'utf8');
    assert.match(midText, new RegExp(`from '\\./${leafHashed.replace('.', '\\.')}'`));
    assert.equal(midHashed, `mid.${sha10(midText)}.js`);

    const entryText = readFileSync(join(dir, 'js', entryHashed), 'utf8');
    assert.match(entryText, new RegExp(`from '\\./${midHashed.replace('.', '\\.')}'`));
    assert.match(entryText, new RegExp(`new URL\\('\\./${leafHashed.replace('.', '\\.')}'`));

    const cssNames = readdirSync(join(dir, 'css')).sort();
    const cssLeafHashed = cssNames.find((n) => n.startsWith('leaf.') && n.endsWith('.css'));
    const cssMainHashed = cssNames.find((n) => n.startsWith('main.') && n.endsWith('.css'));
    assert.ok(cssLeafHashed && cssMainHashed);
    const cssMainText = readFileSync(join(dir, 'css', cssMainHashed), 'utf8');
    assert.match(cssMainText, new RegExp(cssLeafHashed.replace('.', '\\.')));

    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`href="css/${cssMainHashed.replace('.', '\\.')}"`));
    assert.match(html, new RegExp(`from '\\./js/${entryHashed.replace('.', '\\.')}'`));
    assert.match(html, new RegExp(`from '\\./js/stable\\.${preHash}\\.js'`));
    assert.ok(!html.includes('?v='), 'query bust stripped from rewritten refs');
    // image fingerprinted
    const imgNames = readdirSync(join(dir, 'images'));
    assert.equal(imgNames.length, 1);
    assert.match(imgNames[0], /^icon\.[a-f0-9]{10}\.png$/);
    assert.match(html, new RegExp(`/images/${imgNames[0].replace('.', '\\.')}`));
    assert.ok(existsSync(join(dir, 'index.html')), 'index.html not renamed');

    // Stable: re-run on a fresh twin tree yields same leaf hash
    const dir2 = mkdtempSync(join(tmpdir(), 'sw-fp2-'));
    try {
      mkdirSync(join(dir2, 'js'));
      writeFileSync(join(dir2, 'js', 'leaf.js'), leafBody);
      writeFileSync(join(dir2, 'index.html'), '<html></html>');
      const r2 = spawnSync(process.execPath, [SCRIPT, dir2], { encoding: 'utf8' });
      assert.equal(r2.status, 0, r2.stderr || r2.stdout);
      const again = readdirSync(join(dir2, 'js'))[0];
      assert.equal(again, leafHashed);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprintRelease export: dep change busts parent filename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-fp3-'));
  try {
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'js', 'a.js'), 'export const A = 1;\n');
    writeFileSync(join(dir, 'js', 'b.js'), "import { A } from './a.js';\nexport const B = A;\n");
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    fingerprintRelease(dir, { fingerprintImages: false });
    const firstB = readdirSync(join(dir, 'js')).find((n) => n.startsWith('b.'));
    // rebuild with changed leaf
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'js'), { recursive: true });
    writeFileSync(join(dir, 'js', 'a.js'), 'export const A = 2;\n');
    writeFileSync(join(dir, 'js', 'b.js'), "import { A } from './a.js';\nexport const B = A;\n");
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    fingerprintRelease(dir, { fingerprintImages: false });
    const secondB = readdirSync(join(dir, 'js')).find((n) => n.startsWith('b.'));
    assert.notEqual(firstB, secondB, 'parent hash must change when child content changes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint: cyclic leftover still rewrites static imports (game→result)', () => {
  // Mirrors prod bug: parent processed before child in Kahn leftovers left
  // `from './result.js'` bare → 404 → type=module boot dead.
  const dir = mkdtempSync(join(tmpdir(), 'sw-fp-cycle-'));
  try {
    mkdirSync(join(dir, 'js'));
    // Soft cycle via dynamic import() (excluded from topo) + static parent→child.
    writeFileSync(
      join(dir, 'js', 'result.js'),
      "import { A } from './auth.js';\nexport function endGame() { return A; }\n"
    );
    writeFileSync(
      join(dir, 'js', 'jiu-coin.js'),
      "import { A } from './auth.js';\nexport const coin = A;\n"
    );
    writeFileSync(
      join(dir, 'js', 'auth.js'),
      "export const A = 1;\nexport function invalidate() { return import('./leaderboard.js'); }\n"
    );
    writeFileSync(
      join(dir, 'js', 'leaderboard.js'),
      "import { A } from './auth.js';\nexport function board() { return A; }\n"
    );
    writeFileSync(
      join(dir, 'js', 'game.js'),
      "import { endGame } from './result.js';\nimport { coin } from './jiu-coin.js';\nexport const g = endGame() + coin;\n"
    );
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><script type="module">import { g } from './js/game.js';</script>\n`
    );

    fingerprintRelease(dir, { fingerprintImages: false });

    const jsNames = readdirSync(join(dir, 'js'));
    assert.ok(!jsNames.includes('game.js'), 'game.js must be renamed');
    assert.ok(!jsNames.includes('result.js'));
    assert.ok(!jsNames.includes('jiu-coin.js'));
    const gameHashed = jsNames.find((n) => n.startsWith('game.') && n.endsWith('.js'));
    const resultHashed = jsNames.find((n) => n.startsWith('result.') && n.endsWith('.js'));
    const jiuHashed = jsNames.find((n) => n.startsWith('jiu-coin.') && n.endsWith('.js'));
    assert.ok(gameHashed && resultHashed && jiuHashed);
    const gameText = readFileSync(join(dir, 'js', gameHashed), 'utf8');
    assert.match(gameText, new RegExp(`from '\\./${resultHashed.replace(/\./g, '\\.')}'`));
    assert.match(gameText, new RegExp(`from '\\./${jiuHashed.replace(/\./g, '\\.')}'`));
    assert.ok(!gameText.includes("from './result.js'"), 'must not leave bare result.js');
    assert.ok(!gameText.includes("from './jiu-coin.js'"), 'must not leave bare jiu-coin.js');

    const authHashed = jsNames.find((n) => n.startsWith('auth.') && n.endsWith('.js'));
    const lbHashed = jsNames.find((n) => n.startsWith('leaderboard.') && n.endsWith('.js'));
    const authText = readFileSync(join(dir, 'js', authHashed), 'utf8');
    assert.match(
      authText,
      new RegExp(`import\\('\\./${lbHashed.replace(/\./g, '\\.')}'\\)`)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint: real package tree game.js has no bare ./result.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-fp-real-'));
  try {
    // Minimal copy of the modules that formed the prod boot graph.
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    mkdirSync(join(dir, 'shared'));
    const root = fileURLToPath(new URL('..', import.meta.url));
    for (const rel of [
      'js/game.js',
      'js/result.js',
      'js/jiu-coin.js',
      'js/auth.js',
      'js/auth-state.js',
      'js/state.js',
      'js/game-session.js',
      'js/game-sync.js',
      'js/utils.js',
      'js/kline-option.js',
      'js/screen-router.js',
      'js/puzzle-goals-copy.js',
      'js/cloud-draft.js',
      'js/leaderboard.js',
      'js/time.js',
      'js/analysis.js',
      'js/analysis-pure.js',
      'js/puzzle-settle-modal.js',
      'js/puzzle-debrief-copy.js',
      'js/puzzle-settle-copy.js',
      'js/result-share.js',
      'js/daily-challenge.js',
      'js/home-ia.js',
      'js/puzzle-chapter.js',
      'js/pack-store.js',
      'js/pack-url.js',
      'shared/engine.js',
      'shared/puzzleEngine.js',
      'shared/rules.js',
      'css/style.css',
      'css/base.css',
      'css/start.css',
      'css/game.css',
      'css/result.css',
      'css/academy.css',
      'css/hindsight.css',
      'css/fill-mode.css',
      'css/puzzle-chapter.css',
    ]) {
      const src = join(root, rel);
      if (!existsSync(src)) continue;
      writeFileSync(join(dir, rel), readFileSync(src));
    }
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html>
<link rel="stylesheet" href="css/style.css">
<script type="module">
  import { startGame } from './js/game.js';
  import { initAuth } from './js/auth.js';
</script>
`
    );
    fingerprintRelease(dir, { fingerprintImages: false });
    const jsNames = readdirSync(join(dir, 'js'));
    const gameHashed = jsNames.find((n) => /^game\.[a-f0-9]+\.js$/.test(n));
    assert.ok(gameHashed, 'fingerprinted game.js');
    const gameText = readFileSync(join(dir, 'js', gameHashed), 'utf8');
    assert.ok(!/from\s+['"]\.\/result\.js['"]/.test(gameText), 'no bare ./result.js');
    assert.ok(!/from\s+['"]\.\/jiu-coin\.js['"]/.test(gameText), 'no bare ./jiu-coin.js');
    assert.match(gameText, /from\s+['"]\.\/result\.[a-f0-9]+\.js['"]/);
    assert.match(gameText, /from\s+['"]\.\/jiu-coin\.[a-f0-9]+\.js['"]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint: static import cycle fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-fp-static-cycle-'));
  try {
    mkdirSync(join(dir, 'js'));
    writeFileSync(
      join(dir, 'js', 'a.js'),
      "import { B } from './b.js';\nexport const A = B;\n"
    );
    writeFileSync(
      join(dir, 'js', 'b.js'),
      "import { A } from './a.js';\nexport const B = A;\n"
    );
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    assert.throws(
      () => fingerprintRelease(dir, { fingerprintImages: false }),
      /static import cycle/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
