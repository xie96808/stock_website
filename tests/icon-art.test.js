import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coinIconHtml, coinSvgHtml, coinVariantFor, rewindTicketHtml, COIN_VARIANTS, ICON_ART_V,
} from '../js/icon-art.js';
import { coinIconHtml as coinFromJiu } from '../js/jiu-coin.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('coinVariantFor snaps the measured effective px to the nearest drawn size', () => {
  // measured on 390 (0.95em × context font-size): see docs/icon-unify.md
  const cases = [[9.5, 12], [11.39, 12], [12.16, 12], [12.45, 12], [13.06, 14], [13.97, 14], [14.44, 14], [15.19, 16], [15.95, 16], [19, 20], [24, 24]];
  for (const [px, want] of cases) assert.equal(coinVariantFor(px), want, `${px}px`);
  assert.equal(coinVariantFor(NaN), 14);
});

test('coinIconHtml keeps the layout-box contract (root .jiu-coin-icon, aria-hidden, both themes, intrinsic size)', () => {
  const html = coinIconHtml({ size: 14 });
  assert.match(html, /^<span class="jiu-coin-icon" data-coin-art="14" aria-hidden="true">/);
  assert.equal((html.match(/<img /g) || []).length, 2, 'day + night art');
  assert.match(html, /coin-glyph-14\.png\?v=/);
  assert.match(html, /coin-glyph-14-dark\.png\?v=/);
  assert.match(html, /width="14" height="14"/);
  assert.match(html, /loading="lazy"/, 'night twin is lazy');
  assert.ok(html.includes(ICON_ART_V));
  // legacy size args that are not a drawn size are snapped, never emitted raw
  assert.match(coinIconHtml({ size: 13.06 }), /data-coin-art="14"/);
  assert.match(coinIconHtml({ size: 10 }), /data-coin-art="12"/);
  assert.equal(coinFromJiu, coinIconHtml, 'jiu-coin.js re-exports the same function');
});

test('old SVG is preserved verbatim as the fallback glyph', () => {
  const svg = coinSvgHtml({ size: 14 });
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /r="10" fill="currentColor" opacity="\.18"/);
  assert.match(svg, /stroke="currentColor"/);
});

test('every referenced art file exists (png + webp, @1x/@2x)', () => {
  const names = [];
  for (const v of COIN_VARIANTS) names.push(`coin-glyph-${v}`, `coin-glyph-${v}-dark`);
  names.push('ticket-rewind-15x17', 'ticket-rewind-15x17-dark', 'ticket-rewind-12', 'ticket-rewind-12-dark');
  for (const n of names) {
    for (const ext of ['png', 'webp']) {
      for (const sfx of ['', '@2x']) {
        assert.ok(existsSync(join(ROOT, 'assets', 'icon-unify', `${n}${sfx}.${ext}`)), `${n}${sfx}.${ext}`);
      }
    }
  }
});

test('rewind ticket markup (JS + static index.html) uses the 15×17 art and the same cache token', () => {
  const html = rewindTicketHtml();
  assert.match(html, /ticket-rewind-15x17\.png\?v=/);
  assert.match(html, /width="15" height="17"/);
  const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(index.includes(`ticket-rewind-15x17.png?v=${ICON_ART_V}`), 'index.html cache token matches ICON_ART_V');
  assert.ok(!/class="rewind-btn-icon"[^>]*>↩/.test(index), 'no ↩ text glyph left in #rewindBtn');
});

test('dark art is opt-in: day art is the CSS default, kraft surfaces are never listed', () => {
  const css = readFileSync(join(ROOT, 'css', 'jiu-coin.css'), 'utf8');
  const block = css.slice(css.indexOf('icon-unify: drawn 韭币 art'));
  assert.match(block, /\.jiu-coin-pic--night \{ display: none !important; \}/);
  const optIn = /\[data-theme="dark"\] :is\(([\s\S]*?)\) \.jiu-coin-pic--night/.exec(block);
  assert.ok(optIn, 'dark opt-in selector list exists');
  for (const kraft of ['jiu-coin-dialog', 'rewind', 'fill-mode', 'modal', 'rank-card']) {
    assert.ok(!optIn[1].includes(kraft), `kraft surface ${kraft} must not opt into dark art`);
  }
});
