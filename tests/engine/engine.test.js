import test from "node:test";
import assert from 'node:assert/strict';
import { settleGame, replayGame, roundHalfUp, formatReturnPct, RULE_VERSION } from '../../shared/engine.js';
import { GOLDEN_SETTLE, GAME_07_ILLEGAL, makeBars, holds } from '../../shared/fixtures/golden.js';

test('rule_version is sim30-mtm-v1', () => {
  assert.equal(RULE_VERSION, 'sim30-mtm-v1');
});

test('roundHalfUp half away from zero', () => {
  assert.equal(roundHalfUp(1.5), 2);
  assert.equal(roundHalfUp(-1.5), -2);
  assert.equal(roundHalfUp(0.5), 1);
  assert.equal(roundHalfUp(-0.5), -1);
  assert.equal(roundHalfUp(1.4), 1);
  assert.equal(roundHalfUp(-1.4), -1);
});

test('formatReturnPct from ppm', () => {
  assert.equal(formatReturnPct(123400), '12.34');
  assert.equal(formatReturnPct(-10000), '-1.00');
  assert.equal(formatReturnPct(0), '0.00');
});

for (const g of GOLDEN_SETTLE) {
  test(g.id + ' settle', () => {
    const r = settleGame({ fillMode: g.fillMode, bars: g.bars, actions: g.actions });
    assert.equal(r.ok, true, r.message || 'expected ok');
    assert.equal(r.returnPpm, g.expect.returnPpm, 'returnPpm');
    assert.equal(r.returnPct, g.expect.returnPct, 'returnPct');
    assert.equal(r.tradeCount, g.expect.tradeCount, 'tradeCount');
    if (g.expect.hasValuation) {
      assert.ok(r.valuation, 'expected valuation');
      assert.equal(r.valuation.day, g.expect.valuation.day);
      assert.equal(r.valuation.price, g.expect.valuation.price);
      assert.equal(r.valuation.buyPrice, g.expect.valuation.buyPrice);
      assert.equal(r.trades.filter((t) => t.type === 'sell').length, 0);
    } else {
      assert.equal(r.valuation, null);
    }
    if (g.expect.trades) {
      assert.equal(r.trades.length, g.expect.trades.length);
      g.expect.trades.forEach((t, i) => {
        assert.equal(r.trades[i].type, t.type);
        assert.equal(r.trades[i].day, t.day);
        assert.equal(r.trades[i].price, t.price);
      });
    }
  });
}

for (const g of GAME_07_ILLEGAL) {
  test(g.id + ' rejects', () => {
    const result =
      g.finish === true
        ? replayGame({ fillMode: g.fillMode, bars: g.bars, actions: g.actions, finish: true })
        : settleGame({ fillMode: g.fillMode, bars: g.bars, actions: g.actions });
    assert.equal(result.ok, false, g.id + ' should fail');
    assert.equal(result.code, 422);
  });
}

test('GAME-07 invalid fillMode', () => {
  const r = settleGame({ fillMode: 'magic', bars: makeBars(), actions: holds(29) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 422);
});

test('next_open sell on buy-fill day is legal', () => {
  const r = settleGame({
    fillMode: 'next_open',
    bars: makeBars({ 2: { open: 10, close: 10 }, 3: { open: 12, close: 12 } }),
    actions: ['buy', 'sell', ...holds(27)],
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.returnPpm, 200000);
  assert.equal(r.tradeCount, 2);
});

test('partial replay without finish leaves open lot', () => {
  const r = replayGame({
    fillMode: 'next_open',
    bars: makeBars({ 2: { open: 10, close: 10.5 } }),
    actions: ['buy', ...holds(5)],
    finish: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.valuation, null);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].type, 'buy');
  assert.ok(r.rawPosition === 'holding' || r.rawPosition === 'locked');
});
