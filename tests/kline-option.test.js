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
  assert.ok(mp.some((p) => p.value === '估值'));
});
