/**
 * Hand fixtures for curve / MDD / buy-hold (PRD §4.1 next_open valuation).
 */
import { makeBars, holds } from './golden.js';
import { INITIAL_CASH } from '../rules.js';

/** Flat market, all hold — zero return, zero MDD, zero benchmark. */
export const CURVE_FLAT_HOLD = {
  id: 'CURVE-flat-hold',
  fillMode: 'next_open',
  bars: makeBars(),
  actions: holds(29),
  expect: {
    returnPpm: 0,
    mddPpm: 0,
    benchmarkReturnPpm: 0,
    e0: INITIAL_CASH,
    e30: INITIAL_CASH,
    curveLen: 31,
  },
};

/**
 * next_open buy d1 / sell d2 on rising open: fill buy@10 (d2 open), sell@11 (d3 open).
 * Day1 close still cash (pending). Day2 holding at close10 → 100000. Day3+ flat 110000.
 * Peak never drops → MDD 0. Benchmark flat bars → 0.
 */
export const CURVE_BUY_SELL_UP = {
  id: 'CURVE-buy-sell-up',
  fillMode: 'next_open',
  bars: makeBars({
    2: { open: 10, close: 10 },
    3: { open: 11, close: 11 },
  }),
  actions: ['buy', 'sell', ...holds(27)],
  expect: {
    returnPpm: 100000,
    mddPpm: 0,
    benchmarkReturnPpm: 0,
    e1: INITIAL_CASH,
    e2: INITIAL_CASH,
    e3: 110000,
    e30: 110000,
  },
};

/**
 * next_open: buy d1 @ d2 open 10; price crashes d2 close 5 then d3 close 5;
 * sell d3 @ d4 open 5. MDD from peak 100000 → 50000 = 50%.
 * Unfilled buy must not affect day1 close (still 100000).
 */
export const CURVE_DRAWDOWN = {
  id: 'CURVE-drawdown-next-open',
  fillMode: 'next_open',
  bars: makeBars({
    2: { open: 10, close: 5, high: 10, low: 5 },
    3: { open: 5, close: 5, high: 5.1, low: 4.9 },
    4: { open: 5, close: 5 },
  }),
  actions: ['buy', 'hold', 'sell', ...holds(26)],
  expect: {
    returnPpm: -500000,
    mddPpm: 500000,
    benchmarkReturnPpm: 0,
    e1: INITIAL_CASH,
    e2: 50000,
    e3: 50000,
    e4: 50000,
    e30: 50000,
  },
};

/**
 * Buy held to day30 valuation: buy d1 → fill d2 open 10; day30 close 12.
 * Intermediate dip day10 close 8 → MDD 20%.
 */
export const CURVE_HOLD_TO_END = {
  id: 'CURVE-hold-to-end-with-dip',
  fillMode: 'next_open',
  bars: makeBars({
    2: { open: 10, close: 10 },
    10: { open: 9, close: 8, high: 9, low: 8 },
    30: { open: 11, close: 12, high: 12.1, low: 10.9 },
  }),
  actions: ['buy', ...holds(28)],
  expect: {
    returnPpm: 200000,
    mddPpm: 200000,
    benchmarkReturnPpm: 200000,
    e1: INITIAL_CASH,
    e2: INITIAL_CASH,
    e10: 80000,
    e30: 120000,
  },
};

/**
 * same_close: buy d1 @ close 10, sell d2 @ close 9 → loss 10%, MDD 10%.
 */
export const CURVE_SAME_CLOSE_LOSS = {
  id: 'CURVE-same-close-loss',
  fillMode: 'same_close',
  bars: makeBars({
    1: { open: 10, close: 10 },
    2: { open: 9.5, close: 9 },
  }),
  actions: ['buy', 'sell', ...holds(27)],
  expect: {
    returnPpm: -100000,
    mddPpm: 100000,
    benchmarkReturnPpm: 0,
    e1: INITIAL_CASH,
    e2: 90000,
    e30: 90000,
  },
};

export const CURVE_FIXTURES = [
  CURVE_FLAT_HOLD,
  CURVE_BUY_SELL_UP,
  CURVE_DRAWDOWN,
  CURVE_HOLD_TO_END,
  CURVE_SAME_CLOSE_LOSS,
];
