/** Prize pop-up art is preloaded with the wheel's core art, and the pop-up icon slots never render empty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coinArtSrcset, coinIconHtml } from '../js/icon-art.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const LW = rd('js/lucky-wheel.js');

test('coinArtSrcset() returns exactly the webp candidates coinIconHtml() puts in its <picture>', () => {
  for (const night of [false, true]) {
    const { src, srcset } = coinArtSrcset(24, { night });
    assert.ok(coinIconHtml({ size: 24 }).includes(`srcset="${srcset}"`), srcset);
    assert.ok(src.startsWith(`assets/icon-unify/coin-glyph-24${night ? '-dark' : ''}.webp?v=`));
    for (const f of srcset.split(', ').map((c) => c.split(' ')[0].split('?')[0])) assert.ok(existsSync(join(ROOT, f)), f);
  }
});

test('pop-up unit icons ride with the core art; the larger pop-up / 888 art is warmed with the effect art and on spin', () => {
  const core = LW.slice(LW.indexOf('function preloadCoreArt()'), LW.indexOf('const POP_IMG_ART'));
  assert.match(core, /preloadPopIcons\(\);/);
  const icons = LW.slice(LW.indexOf('function preloadPopIcons()'), LW.indexOf('let popArtOn'));
  assert.match(icons, /coinArtSrcset\(POP_COIN_V\)/);
  assert.match(icons, /popWantsNightCoin\(\)/);
  assert.match(icons, /item-ticket-24/);
  assert.match(LW, /const POP_COIN_V = 24;/);
  assert.match(LW, /coinIconHtml\(\{ size: 24 \}\)/); // the pop-up amount still uses the variant being preloaded
  for (const n of ['lw-prize-1', 'lw-prize-5', 'lw-prize-ticket-2', 'lw-prize-ticket-3', 'lw-prize-spin', 'lw-jackpot-rays', 'lw-popup-jackpot-banner'])
    assert.ok(LW.includes(`"${n}"`), n);
  assert.match(LW, /const POP_CSS_ART = \["lw-result-card", "lw-go-default", "lw-go-press"\];/);
  const art = LW.slice(LW.indexOf('function preloadPopArt()'), LW.indexOf('function preloadPopArt()') + 400);
  assert.match(art, /warmFx\(\);/); // coin-burst atlas + confetti for the 888 effect
  assert.match(LW.slice(LW.indexOf('function loadEffectArt()'), LW.indexOf('function loadEffectArt()') + 80), /preloadPopArt\(\);/);
  for (const n of ['item-ticket-24', 'lw-prize-5', 'lw-jackpot-rays', 'lw-popup-jackpot-banner', 'lw-coin-sprite-atlas', 'lw-confetti-1'])
    assert.ok(existsSync(join(ROOT, `assets/lucky-wheel/${n}@2x.webp`)), n);
});

test('openPop guards the icon slots: fixed box, SVG coin / 🎟️ fallback until the art decodes', () => {
  const open = LW.slice(LW.indexOf('function openPop('), LW.indexOf('function openPop(') + 6000);
  assert.match(open, /guardPopIcons\(pop\);/);
  const g = LW.slice(LW.indexOf('function guardPopIcons('), LW.indexOf('function openPop('));
  assert.match(g, /coinSvgHtml\(\{ size: 24 \}\)/);
  assert.match(g, /🎟️/);
  assert.match(g, /lw-icon-pending/);
  const css = rd('css/lucky-wheel.css');
  assert.match(css, /\.lw-pop-amount \.lw-unit \.jiu-coin-icon \{ width: 1\.4em; height: 1\.4em; \}/);
  assert.match(css, /\.lw-pop-headline \.lw-pop-tk \{ width: 1\.3em; height: 1\.3em; \}/);
  assert.match(css, /\.lw-icon-fb \{ position: absolute; inset: 0;/);
  assert.match(css, /\.lw-icon-pending > picture, \.lw-icon-pending > img \{ visibility: hidden; \}/);
});
