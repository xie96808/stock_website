import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKlineOption } from '../js/kline-option.js';
import { computeBestPoints } from '../js/analysis-pure.js';
import {
  makeAnalysisKline,
  HIST_LEN,
  SAMPLE_TRADES_SAME_CLOSE,
} from './fixtures/analysis-sample.js';

const snap = JSON.parse(readFileSync(new URL('./fixtures/analysis-snapshots.json', import.meta.url), 'utf8'));

test('buildKlineOption game+result share day-index axis and 日线 legends', () => {
  const kline = makeAnalysisKline();
  const full = kline.slice(0, HIST_LEN + 30);
  const bp = computeBestPoints({ kline, historyLength: HIST_LEN, patternTag: (n) => n });

  const optGame = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    trades: SAMPLE_TRADES_SAME_CLOSE,
    mode: 'game',
    maSelected: { '5日线': true, '10日线': true, '20日线': true, '30日线': false },
  });
  const optResult = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    trades: SAMPLE_TRADES_SAME_CLOSE,
    bestPoints: bp,
    valuation: { day: 30, price: 11.15 },
    mode: 'result',
  });

  assert.deepEqual(optGame.legend.data, snap.kline.gameLegend);
  assert.deepEqual(optResult.legend.data, snap.kline.resultLegend);
  assert.deepEqual(optGame.series.map((s) => s.name), snap.kline.gameSeriesNames);
  assert.deepEqual(optResult.series.map((s) => s.name), snap.kline.resultSeriesNames);
  assert.equal(optGame.xAxis[0].data.length, snap.kline.dayLabelLen);
  assert.equal(optGame.xAxis[0].data[0], snap.kline.firstDayLabel);
  assert.equal(optGame.xAxis[0].data[HIST_LEN], snap.kline.startDayLabel);
  assert.equal(!!optResult.series[0].markLine, snap.kline.resultHasMarkLine);
  assert.equal(optResult.series[0].markLine.data[0].label.formatter, snap.kline.markLineFormatter);
  assert.equal(!!optResult.xAxis[1].axisLabel.rich, snap.kline.resultAxisRich);
  assert.equal(optGame.animation, snap.kline.gameAnim);
  assert.equal(optGame.series.find((s) => s.name === '5日线').data[0], snap.kline.ma5FirstGame);
  assert.equal(optResult.series.find((s) => s.name === '5日线').data[0], snap.kline.ma5FirstResult);

  // Tooltip calendar date comes from bars (formatter closes over bars).
  const tip = optResult.tooltip.formatter([
    { seriesName: 'K线', dataIndex: HIST_LEN, data: [11, 11, 10, 12] },
  ]);
  assert.match(tip, /2024-/);
  assert.match(tip, /开 /);
});

test('buildKlineOption result markPoint includes trades + best points + valuation', () => {
  const kline = makeAnalysisKline();
  const full = kline.slice(0, HIST_LEN + 30);
  const bp = { buys: [{ day: 5, price: 10 }], sells: [{ day: 9, price: 11 }] };
  const opt = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    trades: [{ type: 'buy', day: 5, price: 10.18 }],
    bestPoints: bp,
    valuation: { day: 30, price: 11.15 },
    mode: 'result',
  });
  const mp = opt.series[0].markPoint.data;
  assert.ok(mp.some((p) => p.value === '买'));
  assert.ok(mp.some((p) => p.name === 'B1'));
  assert.ok(mp.some((p) => p.name === 'S1'));
  assert.ok(mp.some((p) => p.value === '期末估值'));
});

test('buildKlineOption includes inside dataZoom for touch pinch/slide', () => {
  const kline = makeAnalysisKline();
  const full = kline.slice(0, HIST_LEN + 30);
  const optGame = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    trades: SAMPLE_TRADES_SAME_CLOSE,
    mode: 'game',
    resetDataZoom: true,
    showDataZoomSlider: false,
  });
  assert.ok(Array.isArray(optGame.dataZoom));
  assert.equal(optGame.dataZoom.length, 1);
  assert.equal(optGame.dataZoom[0].type, 'inside');
  assert.deepEqual(optGame.dataZoom[0].xAxisIndex, [0, 1]);
  assert.equal(optGame.dataZoom[0].filterMode, 'none');
  assert.equal(optGame.dataZoom[0].start, 0);
  assert.equal(optGame.dataZoom[0].end, 100);
  assert.ok(optGame.dataZoom[0].minSpan >= 1);

  const optResult = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    trades: SAMPLE_TRADES_SAME_CLOSE,
    mode: 'result',
    resetDataZoom: true,
  });
  assert.ok(optResult.dataZoom.some((z) => z.type === 'inside'));
  assert.ok(optResult.dataZoom.some((z) => z.type === 'slider'));
});

test('buildKlineOption omits dataZoom start/end when not resetting', () => {
  const kline = makeAnalysisKline();
  const full = kline.slice(0, HIST_LEN + 30);
  const opt = buildKlineOption({
    bars: full,
    historyLength: HIST_LEN,
    mode: 'game',
    resetDataZoom: false,
    showDataZoomSlider: false,
  });
  assert.equal(opt.dataZoom[0].start, undefined);
  assert.equal(opt.dataZoom[0].end, undefined);
});

test('legend(d): MA legend uses compact fixed metrics so 4 entries fit one row at 360px', async () => {
  const { LEGEND_FONT_PX, LEGEND_ITEM_W, LEGEND_ITEM_GAP } = await import('../js/kline-option.js');
  // widest layout: 5/10/20/30日线 text (3+4+4+4 CJK/digit chars, ~font px each) + 4 symbols + 3 gaps + left inset
  const chars = 3 + 4 + 4 + 4;
  const est = chars * LEGEND_FONT_PX + 4 * (LEGEND_ITEM_W + 5) + 3 * LEGEND_ITEM_GAP + 8;
  assert.ok(est <= 270, 'legend would wrap on a 282px chart: ' + est);
  const bars = Array.from({ length: 30 }, (_, i) => ({ date: '2026-01-' + String(i + 1).padStart(2, '0'), open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }));
  const opt = buildKlineOption({ bars, mode: 'game' });
  assert.equal(opt.legend.textStyle.fontSize, LEGEND_FONT_PX);
  assert.equal(opt.legend.itemGap, LEGEND_ITEM_GAP);
});

test('clean battle layout: no x-axis dates, 3 price ticks, day-1 marker, thicker distinct MA lines', async () => {
  const { MA_LINE_WIDTH } = await import('../js/kline-option.js');
  const { MA_DAY_COLORS } = await import('../js/utils.js');
  const kline = makeAnalysisKline();
  const hist = HIST_LEN;
  const full = kline.slice(0, hist + 5);
  for (const mode of ['game', 'pvp']) {
    const bars = mode === 'pvp'
      ? full.map((b, i) => ({ ...b, label: i < hist ? 'h' + (i + 1) : 'd' + (i - hist + 1) }))
      : full;
    const opt = buildKlineOption({ bars, historyLength: hist, mode, pvpBottom: mode === 'pvp' ? 'volume' : null });
    // axes: nothing to decode on the horizontal axis
    assert.ok(opt.xAxis.every((x) => x.axisLabel.show === false), mode + ' x labels hidden');
    assert.equal(opt.yAxis[0].splitNumber, 3);
    // one price pane + one thin volume/MACD pane
    assert.equal(opt.grid.length, 2);
    // MA lines: thicker than the old 1px and four different colours
    const mas = opt.series.filter((s) => /日线$/.test(s.name));
    assert.equal(mas.length, 4);
    assert.ok(mas.every((s) => s.lineStyle.width === MA_LINE_WIDTH && MA_LINE_WIDTH > 1));
    assert.equal(new Set(mas.map((s) => s.lineStyle.color)).size, 4);
    assert.deepEqual(mas.map((s) => s.lineStyle.color), Object.values(MA_DAY_COLORS));
    // legend names every MA (battle used to hide it)
    assert.deepEqual(opt.legend.data, ['5日线', '10日线', '20日线', '30日线']);
    // 「第1天」 marker between the last history bar and day 1
    const ml = opt.series[0].markLine;
    assert.equal(ml.data[0].xAxis, hist - 0.5);
    assert.match(ml.data[0].label.formatter, /第1天|开局/);
    // bottom-strip caption
    assert.ok(/成交量/.test(opt.graphic[0].style.text));
  }
});

test('clean layout leaves the result chart untouched (dates, slider, 开局第1天 line)', () => {
  const kline = makeAnalysisKline();
  const opt = buildKlineOption({ bars: kline.slice(0, HIST_LEN + 30), historyLength: HIST_LEN, mode: 'result' });
  assert.notEqual(opt.xAxis[1].axisLabel.show, false);
  assert.equal(opt.series.filter((s) => /日线$/.test(s.name))[0].lineStyle.width, 1);
  assert.equal(opt.graphic, undefined);
  assert.ok(opt.series[0].markLine);
});

test('no day-1 marker before the first day exists', () => {
  const kline = makeAnalysisKline();
  const opt = buildKlineOption({ bars: kline.slice(0, HIST_LEN), historyLength: HIST_LEN, mode: 'game' });
  assert.equal(opt.series[0].markLine, undefined);
});
