import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shareWindowBars, shareMarks, priceRange } from '../js/share-kline.js';

const bar = (o, c, h, l) => ({ open: o, close: c, high: h, low: l });

test('shareWindowBars: only the played window after history, dropping broken bars', () => {
  const bars = Array.from({ length: 10 }, (_, i) => bar(i, i + 1, i + 2, i - 1));
  const win = shareWindowBars(bars, 4, 3);
  assert.equal(win.length, 3);
  assert.equal(win[0].open, 4);
  assert.deepEqual(shareWindowBars(null, 0, 30), []);
  assert.equal(shareWindowBars([bar(1, 2, 3, 0), { open: 'x', close: 1, high: 1, low: 1 }], 0, 30).length, 1);
});

test('shareMarks: day is 1-based, out-of-window and unknown trades are ignored', () => {
  const marks = shareMarks(
    [{ type: 'buy', day: 1 }, { type: 'sell', day: 30 }, { type: 'sell', day: 31 }, { type: 'buy', day: 0 }, { type: 'hold', day: 5 }, null],
    30
  );
  assert.deepEqual(marks, [{ index: 0, kind: 'buy' }, { index: 29, kind: 'sell' }]);
});

test('priceRange: padded and never zero-width, even for a flat series', () => {
  const r = priceRange([bar(10, 12, 13, 9), bar(12, 11, 14, 10)]);
  assert.ok(r.lo < 9 && r.hi > 14);
  const flat = priceRange([bar(5, 5, 5, 5)]);
  assert.ok(flat.hi > flat.lo);
  assert.deepEqual(priceRange([]), { lo: 0, hi: 1 });
});

test('share image is just return + stock + dates + K-line (no grade / promo copy), and 复制文案 is gone', () => {
  const js = readFileSync(new URL('../js/result-share.js', import.meta.url), 'utf8');
  for (const gone of ['rssGrade', 'rssPromo', 'result-share-sheet__brand', 'copyResultShareText', 'resultShareCopyBtn']) {
    assert.ok(!js.includes(gone), `${gone} should be removed`);
  }
  for (const id of ['rssStock', 'rssMeta', 'rssReturn', 'rssKline']) assert.ok(js.includes(id), id);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('copyResultShareText') && !html.includes('resultShareCopyBtn'));
});

test('stake result: play-again label has no 韭币局 suffix', () => {
  const js = readFileSync(new URL('../js/result.js', import.meta.url), 'utf8');
  assert.ok(!js.includes('再来一局韭币局'));
});
