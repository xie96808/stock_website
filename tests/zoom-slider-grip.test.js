import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKlineOption, ZOOM_SLIDER_HEIGHT } from '../js/kline-option.js';
import {
  GRIP_HIT_PX,
  GRIP_MIN_SPAN,
  DRAG_ANIMATION,
  sliderRect,
  hitTest,
  dragWindow,
  centerWindow,
  snapPct,
  easeOutCubic,
  getSliderColors,
  sliderThemePatch,
  applySliderTheme,
  attachZoomSliderGrip,
} from '../js/zoom-slider-grip.js';
import { makeAnalysisKline, HIST_LEN } from './fixtures/analysis-sample.js';

const bars = makeAnalysisKline().slice(0, HIST_LEN + 30);

test('复盘 slider: taller strip, realtime unthrottled, aligned with the grids', () => {
  const opt = buildKlineOption({ bars, historyLength: HIST_LEN, mode: 'result' });
  const sl = opt.dataZoom.find((d) => d.type === 'slider');
  assert.ok(sl, 'result chart keeps its slider');
  assert.ok(ZOOM_SLIDER_HEIGHT >= 28 && ZOOM_SLIDER_HEIGHT <= 36);
  assert.equal(sl.height, ZOOM_SLIDER_HEIGHT);
  assert.equal(sl.realtime, true);
  assert.equal(sl.throttle, 0);
  assert.equal(sl.left, opt.grid[0].left);
  assert.equal(sl.right, opt.grid[0].right);
  assert.equal(sl.brushSelect, false);
  // inside (pinch / wheel) zoom unchanged
  assert.equal(opt.dataZoom[0].type, 'inside');
  assert.equal(opt.dataZoom[0].minSpan, GRIP_MIN_SPAN);
});

test('slider stays off the in-game / PvP charts', () => {
  for (const vm of [
    { bars, historyLength: HIST_LEN, mode: 'game' },
    { bars, historyLength: HIST_LEN, mode: 'game', showDataZoomSlider: false },
    { bars, mode: 'pvp', showDataZoomSlider: false },
    { bars, mode: 'pvp', pvpBottom: 'macd', showDataZoomSlider: false },
  ]) {
    assert.equal(buildKlineOption(vm).dataZoom.filter((d) => d.type === 'slider').length, 0, vm.mode);
  }
});

test('grip geometry + hit test: 44px targets, overlap resolves by side', () => {
  assert.equal(GRIP_HIT_PX, 44);
  const r = sliderRect({ left: 44, right: 14, height: 30, bottom: 8 }, 360, 500);
  assert.deepEqual([r.x0, r.x1, r.w, r.top, r.cy], [44, 346, 302, 462, 477]);
  assert.equal(hitTest(100, 100, 300), 'start');
  assert.equal(hitTest(121, 100, 300), 'start'); // within 22px
  assert.equal(hitTest(279, 100, 300), 'end');
  assert.equal(hitTest(200, 100, 300), 'move');
  assert.equal(hitTest(40, 100, 300), 'jump');
  assert.equal(hitTest(95, 100, 105), 'start');
  assert.equal(hitTest(110, 100, 105), 'end');
});

test('drag maths clamps to [0,100] and keeps the min span', () => {
  assert.deepEqual(dragWindow('start', 10, 60, -30), [0, 60]);
  assert.deepEqual(dragWindow('start', 10, 60, 80), [52, 60]);
  assert.deepEqual(dragWindow('end', 10, 60, 80), [10, 100]);
  assert.deepEqual(dragWindow('end', 10, 60, -80), [10, 18]);
  assert.deepEqual(dragWindow('move', 10, 60, 70), [50, 100]);
  assert.deepEqual(dragWindow('move', 10, 60, -70), [0, 50]);
  assert.deepEqual(centerWindow(95, 10, 30), [80, 100]);
  assert.deepEqual(centerWindow(50, 10, 30), [40, 60]);
});

test('settle snaps to bar boundaries; ease is monotone 0→1', () => {
  assert.equal(snapPct(52.3, 11), 50);
  assert.equal(snapPct(56, 11), 60);
  assert.equal(snapPct(100, 11), 100);
  assert.equal(snapPct(33.3, 0), 33.3);
  let prev = -1;
  for (let i = 0; i <= 10; i++) {
    const v = easeOutCubic(i / 10);
    assert.ok(v >= prev);
    prev = v;
  }
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.deepEqual(DRAG_ANIMATION, { duration: 0 });
});

test('slider theme: light/dark paper colours, applied only to the slider', () => {
  const l = getSliderColors('light');
  const d = getSliderColors('dark');
  assert.notEqual(l.fillerColor, d.fillerColor);
  assert.notEqual(l.selLine, d.selLine);
  const p = sliderThemePatch('dark');
  assert.equal(p.fillerColor, d.fillerColor);
  assert.equal(p.selectedDataBackground.lineStyle.color, d.selLine);
  const calls = [];
  const chart = { setOption: (o) => calls.push(o), isDisposed: () => false };
  applySliderTheme(chart, 'dark', { dataZoom: [{ type: 'inside' }, { type: 'slider' }] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].dataZoom[0], {});
  assert.equal(calls[0].dataZoom[1].fillerColor, d.fillerColor);
  applySliderTheme(chart, 'dark', { dataZoom: [{ type: 'inside' }] });
  assert.equal(calls.length, 1, 'no slider → no setOption (would create one)');
  assert.equal(attachZoomSliderGrip(chart, { dataZoom: [{ type: 'slider' }] }), null, 'no DOM → no grip');
});

test('result screen wires the grip and keeps the stock slider as fallback', () => {
  const src = readFileSync(new URL('../js/result.js', import.meta.url), 'utf8');
  assert.match(src, /attachZoomSliderGrip\(chartRefs\.resultChart, option, \{ barCount: fullData\.length \}\)/);
  assert.match(src, /resultGrip\.destroy\(\)/);
  assert.match(src, /applySliderTheme\(chartRefs\.resultChart, theme, resultOption\)/);
  const css = readFileSync(new URL('../css/result.css', import.meta.url), 'utf8');
  assert.match(css, /\.zs-grip \{[^}]*touch-action: none/);
  assert.doesNotMatch(css.slice(css.indexOf('.zs-grip')), /url\(|noise|grain|speckle/i);
});
