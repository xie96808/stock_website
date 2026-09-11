import test from 'node:test';
import assert from 'node:assert/strict';
import { settleGame, roundHalfUp } from '../../shared/engine.js';
import {
  buildEquityCurveCash,
  mddPpmFromCurve,
  buyHoldBenchmarkPpm,
  settleCurveMetrics,
  revealedGameDay,
  SCORE_VERSION_CURVE_V1,
} from '../../shared/equityCurve.js';
import { CURVE_FIXTURES } from '../../shared/fixtures/equityCurve.js';
import { INITIAL_CASH } from '../../shared/rules.js';
import { makeBars, holds } from '../../shared/fixtures/golden.js';

test('revealedGameDay cursor', () => {
  assert.equal(revealedGameDay(0), 1);
  assert.equal(revealedGameDay(1), 2);
  assert.equal(revealedGameDay(28), 29);
  assert.equal(revealedGameDay(29), 30);
  assert.equal(revealedGameDay(100), 30);
});

test('next_open unfilled order does not change decision-day close equity', () => {
  const bars = makeBars({ 2: { open: 10, close: 12 } });
  const curve = buildEquityCurveCash({
    fillMode: 'next_open',
    bars,
    actions: ['buy'],
    finish: false,
  });
  // revealed through day 2: E0, E1, E2
  assert.equal(curve.length, 3);
  assert.equal(roundHalfUp(curve[1]), INITIAL_CASH); // day1 still cash
  assert.equal(roundHalfUp(curve[2]), roundHalfUp(INITIAL_CASH * (12 / 10)));
});

for (const g of CURVE_FIXTURES) {
  test(`${g.id} settle metrics + golden returnPpm`, () => {
    const settled = settleGame({
      fillMode: g.fillMode,
      bars: g.bars,
      actions: g.actions,
    });
    assert.equal(settled.ok, true, settled.message);
    assert.equal(settled.returnPpm, g.expect.returnPpm, 'engine returnPpm');

    const metrics = settleCurveMetrics({
      fillMode: g.fillMode,
      bars: g.bars,
      actions: g.actions,
    });
    assert.equal(metrics.mddPpm, g.expect.mddPpm, 'mddPpm');
    assert.equal(metrics.benchmarkReturnPpm, g.expect.benchmarkReturnPpm, 'benchmark');
    assert.equal(metrics.scoreVersion, SCORE_VERSION_CURVE_V1);
    assert.equal(metrics.equityCurve.length, 31);
    assert.equal(metrics.equityCurve[0].day, 0);
    assert.equal(metrics.equityCurve[0].equity, INITIAL_CASH);

    const cash = buildEquityCurveCash({
      fillMode: g.fillMode,
      bars: g.bars,
      actions: g.actions,
      finish: true,
    });
    assert.equal(mddPpmFromCurve(cash), g.expect.mddPpm);
    assert.equal(buyHoldBenchmarkPpm({ fillMode: g.fillMode, bars: g.bars }), g.expect.benchmarkReturnPpm);

    if (g.expect.e1 != null) assert.equal(roundHalfUp(cash[1]), g.expect.e1);
    if (g.expect.e2 != null) assert.equal(roundHalfUp(cash[2]), g.expect.e2);
    if (g.expect.e3 != null) assert.equal(roundHalfUp(cash[3]), g.expect.e3);
    if (g.expect.e4 != null) assert.equal(roundHalfUp(cash[4]), g.expect.e4);
    if (g.expect.e10 != null) assert.equal(roundHalfUp(cash[10]), g.expect.e10);
    if (g.expect.e30 != null) assert.equal(roundHalfUp(cash[30]), g.expect.e30);
  });
}

test('legacy golden GAME-01 still zero curve metrics', () => {
  const bars = makeBars();
  const actions = holds(29);
  const m = settleCurveMetrics({ fillMode: 'next_open', bars, actions });
  assert.equal(m.mddPpm, 0);
  assert.equal(m.benchmarkReturnPpm, 0);
});
