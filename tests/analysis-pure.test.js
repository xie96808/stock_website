import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeBestPoints,
  computeBSReport,
  computeKlineAnalysisModel,
  calcGrade,
  calcMANullPad,
} from '../js/analysis-pure.js';
import { calculateMA } from '../js/utils.js';
import {
  makeAnalysisKline,
  HIST_LEN,
  SAMPLE_TRADES_SAME_CLOSE,
  SAMPLE_TRADE_GAINS,
} from './fixtures/analysis-sample.js';

const snap = JSON.parse(readFileSync(new URL('./fixtures/analysis-snapshots.json', import.meta.url), 'utf8'));

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

test('calcMANullPad differs from calculateMA (not safe to merge)', () => {
  const kline = makeAnalysisKline().slice(0, 8);
  const a = calcMANullPad(kline, 5);
  const b = calculateMA(kline, 5);
  assert.deepEqual(a, snap.maDiffer.nullPad);
  assert.deepEqual(b, snap.maDiffer.expanding);
  assert.notDeepEqual(a, b);
});

test('computeBestPoints snapshot (scores / days / reason tags)', () => {
  const kline = makeAnalysisKline();
  const bp = computeBestPoints({ kline, historyLength: HIST_LEN, patternTag: (n) => n });
  assert.deepEqual(bp.buys.map((p) => p.day), snap.bestPoints.buyDays);
  assert.deepEqual(bp.sells.map((p) => p.day), snap.bestPoints.sellDays);
  assert.deepEqual(bp.buys.map((p) => p.score), snap.bestPoints.buyScores);
  assert.deepEqual(bp.sells.map((p) => p.score), snap.bestPoints.sellScores);
  assert.deepEqual(
    bp.buys.map((p) => p.reasons.map((r) => r.tag)),
    snap.bestPoints.buyReasonsTags,
  );
  assert.deepEqual(
    bp.sells.map((p) => p.reasons.map((r) => r.tag)),
    snap.bestPoints.sellReasonsTags,
  );
});

test('computeBSReport snapshot (score / grade / details)', () => {
  const kline = makeAnalysisKline();
  const report = computeBSReport({
    kline,
    historyLength: HIST_LEN,
    trades: SAMPLE_TRADES_SAME_CLOSE,
    fillMode: 'same_close',
    totalReturn: 1.12,
    tradeGains: SAMPLE_TRADE_GAINS,
  });
  assert.equal(report.score, snap.bs.score);
  assert.equal(report.grade, snap.bs.grade);
  assert.equal(report.gradeCls, snap.bs.gradeCls);
  assert.deepEqual(report.details.map((d) => d.label), snap.bs.detailLabels);
  assert.deepEqual(report.details.map((d) => d.value), snap.bs.detailValues);
  assert.equal(report.comment, snap.bs.comment);
  assert.equal(Number(report.periodReturn.toFixed(6)), snap.bs.periodReturn);
  assert.equal(Number(report.userReturn.toFixed(6)), snap.bs.userReturn);
});

test('computeBSReport next_open fill mode still returns bounded score', () => {
  const kline = makeAnalysisKline();
  const report = computeBSReport({
    kline,
    historyLength: HIST_LEN,
    trades: [
      { type: 'buy', day: 2, price: kline[HIST_LEN + 2].open },
      { type: 'sell', day: 10, price: kline[HIST_LEN + 10].open },
    ],
    fillMode: 'next_open',
    totalReturn: 1.05,
    tradeGains: [5],
  });
  assert.ok(report.score >= 0 && report.score <= 100);
  assert.ok(['优秀', '良好', '中等', '待提升'].includes(report.grade));
});

test('computeKlineAnalysisModel snapshot (tags + html hash)', () => {
  const kline = makeAnalysisKline();
  const model = computeKlineAnalysisModel({ kline, historyLength: HIST_LEN });
  assert.deepEqual(model.tags, snap.analysis.tags);
  assert.equal(model.trend, snap.analysis.trend);
  assert.equal(model.volatility, snap.analysis.volatility);
  assert.equal(model.maAlignment, snap.analysis.maAlignment);
  assert.equal(Number(model.periodReturn.toFixed(4)), snap.analysis.periodReturn1);
  assert.equal(simpleHash(model.analysisHtml), snap.analysis.analysisHtmlHash);
});

test('calcGrade snapshot', () => {
  assert.deepEqual(calcGrade(12, snap.bs.score), snap.grade);
  assert.equal(calcGrade(-8, 50).letter, 'D');
  assert.equal(calcGrade(20, 95).letter, 'S');
});
