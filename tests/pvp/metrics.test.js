import test from 'node:test';
import assert from 'node:assert/strict';
import { replayGame, settleGame, roundHalfUp } from '../../shared/engine.js';
import { buildEquityCurveCash } from '../../shared/equityCurve.js';
import { INITIAL_CASH, DECISION_DAYS, GAME_DAYS } from '../../shared/rules.js';
import { makeBars, holds } from '../../shared/fixtures/golden.js';
import {
  roundView,
  visibleMtmPpm,
  actionAvailability,
  decideCompletedWinner,
  reconcileReturns,
} from '../../shared/pvpMetrics.js';

function curvePpm(bars, actions) {
  const k = actions.length;
  if (k === 0) return 0;
  const curve = buildEquityCurveCash({
    fillMode: 'next_open',
    bars,
    actions,
    finish: k === DECISION_DAYS,
  });
  return roundHalfUp((curve.at(-1) / INITIAL_CASH - 1) * 1e6);
}

test('R01 each resolved count shows k+1 bars and decisions only through 29', () => {
  for (let k = 0; k <= 29; k++) {
    const view = roundView(k);
    assert.equal(view.ok, true);
    assert.equal(view.revealedBars, k + 1);
    assert.equal(view.revealedBars <= GAME_DAYS, true);
    if (k < 29) {
      assert.equal(view.round, k + 1);
      assert.equal(view.decisionOpen, true);
    } else {
      assert.equal(view.round, null);
      assert.equal(view.decisionOpen, false);
      assert.equal(view.revealedBars, 30);
    }
  }
  assert.equal(roundView(30).ok, false);
  assert.equal(roundView(-1).ok, false);
});

test('R02 d1 buy is -50% on the engine and +10% on the revealed PvP NAV', () => {
  const bars = makeBars({
    1: { open: 10, close: 10 },
    2: { open: 20, close: 22 },
  });
  const engine = replayGame({ fillMode: 'next_open', bars, actions: ['buy'], finish: false });
  assert.equal(engine.ok, true);
  assert.equal(engine.returnPpm, -500000);

  const locked = visibleMtmPpm({ bars, actions: [] });
  assert.equal(locked.visibleMtmPpm, 0);

  const revealed = visibleMtmPpm({ bars, actions: ['buy'] });
  assert.equal(revealed.ok, true);
  assert.equal(revealed.visibleMtmPpm, 100000);
  assert.equal(revealed.visibleMtmPpm, curvePpm(bars, ['buy']));
});

test('R03 d2 sell is legal while the engine still reports locked after d1 buy', () => {
  const bars = makeBars({
    2: { open: 20, close: 22 },
    3: { open: 21, close: 21 },
  });
  const afterBuy = replayGame({ fillMode: 'next_open', bars, actions: ['buy'], finish: false });
  assert.equal(afterBuy.rawPosition, 'locked');

  const avail = actionAvailability({ bars, actions: ['buy'] });
  assert.deepEqual(avail, { canBuy: false, canSell: true, canHold: true });

  const sold = replayGame({
    fillMode: 'next_open',
    bars,
    actions: ['buy', 'sell'],
    finish: false,
  });
  assert.equal(sold.ok, true);
});

test('R04 day-29 buy values at day-30 close and does not invent a sell', () => {
  const bars = makeBars({
    30: { open: 20, close: 30 },
  });
  const actions = [...holds(28), 'buy'];
  assert.equal(actions.length, 29);
  const nav = visibleMtmPpm({ bars, actions });
  const settled = settleGame({ fillMode: 'next_open', bars, actions });
  assert.equal(settled.ok, true);
  assert.equal(settled.valuation != null, true);
  assert.equal(settled.valuation.kind, 'valuation');
  assert.equal(settled.tradeCount, 1);
  assert.equal(settled.trades.some((t) => t.type === 'sell'), false);
  assert.equal(nav.ok, true);
  assert.equal(nav.finalReturnPpm, 500000);
  assert.equal(nav.finalReturnPpm, settled.returnPpm);
  assert.equal(actionAvailability({ bars, actions }).canHold, false);
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBars(rng) {
  const bars = [];
  let price = 10 + rng() * 90;
  for (let d = 0; d < 30; d++) {
    const open = price;
    const close = Math.max(0.5, open * (0.85 + rng() * 0.3));
    const high = Math.max(open, close) * (1 + rng() * 0.02);
    const low = Math.min(open, close) * (1 - rng() * 0.02);
    bars.push({ open, high, low, close, volume: 1000 + Math.floor(rng() * 1000) });
    price = close;
  }
  return bars;
}

function randomLegalActions(rng, bars) {
  const actions = [];
  for (let i = 0; i < 29; i++) {
    const choices = ['buy', 'sell', 'hold'].filter((action) =>
      replayGame({ fillMode: 'next_open', bars, actions: [...actions, action], finish: false }).ok
    );
    assert.equal(choices.includes('hold'), true);
    actions.push(choices[Math.floor(rng() * choices.length)]);
  }
  return actions;
}

test('R05 1000 legal sequences match the curve tail and the finished settle', () => {
  const rng = mulberry32(20261011);
  for (let n = 0; n < 1000; n++) {
    const bars = randomBars(rng);
    const actions = randomLegalActions(rng, bars);
    for (let k = 0; k <= 29; k++) {
      const prefix = actions.slice(0, k);
      const nav = visibleMtmPpm({ bars, actions: prefix });
      assert.equal(nav.ok, true, `seq ${n} k ${k}`);
      assert.equal(nav.visibleMtmPpm, curvePpm(bars, prefix));
    }
    const settled = settleGame({ fillMode: 'next_open', bars, actions });
    assert.equal(settled.ok, true);
    assert.equal(visibleMtmPpm({ bars, actions }).finalReturnPpm, settled.returnPpm);
  }
});

test('completed winner uses return, then smaller drawdown, else draw', () => {
  assert.equal(
    decideCompletedWinner(
      { userId: 'a', returnPpm: 10, mddPpm: 50 },
      { userId: 'b', returnPpm: 9, mddPpm: 1 }
    ),
    'a'
  );
  assert.equal(
    decideCompletedWinner(
      { userId: 'a', returnPpm: 10, mddPpm: 40 },
      { userId: 'b', returnPpm: 10, mddPpm: 30 }
    ),
    'b'
  );
  assert.equal(
    decideCompletedWinner(
      { userId: 'a', returnPpm: 10, mddPpm: 30 },
      { userId: 'b', returnPpm: 10, mddPpm: 30 }
    ),
    null
  );
});

test('a final curve/settle disagreement is a mismatch, not a silent score', () => {
  const bad = reconcileReturns(100000, -500000);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'MTM_MISMATCH');
  assert.equal(bad.visibleMtmPpm, 100000);
  assert.equal(bad.settleReturnPpm, -500000);
  assert.equal(reconcileReturns(100000, 100000).ok, true);
});
