import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, "\n");

test('选择成交方式: option copy (same_close drops 「（今买明才能卖）」)', () => {
  const html = read('index.html');
  assert.ok(html.includes('<small>今晚点单，次日开盘价成交，T+1</small>'));
  assert.ok(html.includes('<small>看完今 K 再点，按今收成交，T+1</small>'));
  assert.ok(!html.includes('今买明才能卖'));
  assert.match(html, /<input type="radio" name="fillMode" value="next_open" checked>/);
  assert.match(html, /<input type="radio" name="fillMode" value="same_close">/);
});

test('选择成交方式: picker is a plain column (no popover 9-slice notch), cards own one outline', () => {
  const p5 = read('css/controls-p5.css');
  assert.ok(!/fill-mode-picker/.test(p5), 'popover border-image must not target .fill-mode-picker');
  const css = read('css/fill-mode.css');
  assert.match(css, /#fillModeModal \.fill-mode-picker[\s\S]*?border-image: none;[\s\S]*?gap: 12px;/);
  const sel = css.match(/#fillModeModal \.fill-mode-option:has\(input:checked\)[^{]*\{([^}]*)\}/);
  assert.ok(sel, 'selected rule present');
  assert.ok(!/0 0 0 \dpx/.test(sel[1]), 'no outer ring box-shadow on the selected card');
  const opt = css.match(/#fillModeModal \.fill-mode-option,\n\[data-theme="dark"\] #fillModeModal \.fill-mode-option \{([^}]*)\}/);
  assert.ok(opt, 'option rule present');
  for (const ms of opt[1].match(/(\d+)ms/g) || []) assert.ok(parseInt(ms, 10) <= 120, `press/selection feedback ${ms} ≤ 120ms`);
});

test('home hero panel: 当日参考盈亏 amount + pct never wrap', () => {
  const css = read('css/home-arcade.css');
  const vw = css.match(/\.ha-bp \.vw \{([^}]*)\}/);
  assert.ok(vw && /flex-wrap: nowrap;/.test(vw[1]));
  assert.match(css, /\.ha-bp \.val \{[^}]*font-size: calc\(var\(--u\) \* 34 \* var\(--fit, 1\)\);/);
  assert.match(css, /\.ha-bp \.pct \{[^}]*font-size: calc\(var\(--u\) \* 25 \* var\(--fit, 1\)\);/);
  const js = read('js/home-arcade.js');
  assert.match(js, /function fitPanel\(\)/);
  assert.match(js, /watchPanelFit\(\);/);
});
