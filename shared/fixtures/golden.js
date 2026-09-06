/**
 * Golden OHLC windows + action sequences for GAME-01..07 (sim30-mtm-v1).
 */

export function makeBars(overrides = {}, base = 10) {
  const bars = [];
  for (let d = 1; d <= 30; d++) {
    const o = overrides[d] || {};
    const open = o.open != null ? o.open : base;
    const close = o.close != null ? o.close : open;
    const high = o.high != null ? o.high : Math.max(open, close) * 1.01;
    const low = o.low != null ? o.low : Math.min(open, close) * 0.99;
    bars.push({
      open,
      high,
      low,
      close,
      date: `2024-01-${String(d).padStart(2, '0')}`,
      volume: 1000,
    });
  }
  return bars;
}

export function holds(n) {
  return Array.from({ length: n }, () => 'hold');
}

export const GAME_01 = {
  id: 'GAME-01',
  fillMode: 'next_open',
  bars: makeBars(),
  actions: holds(29),
  expect: { returnPpm: 0, returnPct: '0.00', tradeCount: 0, hasValuation: false },
};

export const GAME_02 = {
  id: 'GAME-02',
  fillMode: 'next_open',
  bars: makeBars({ 2: { open: 10, close: 10 }, 3: { open: 11, close: 11 } }),
  actions: ['buy', 'sell', ...holds(27)],
  expect: {
    returnPpm: 100000,
    returnPct: '10.00',
    tradeCount: 2,
    hasValuation: false,
    trades: [
      { type: 'buy', day: 2, price: 10 },
      { type: 'sell', day: 3, price: 11 },
    ],
  },
};

export const GAME_03 = {
  id: 'GAME-03',
  fillMode: 'same_close',
  bars: makeBars({ 1: { open: 10, close: 10 }, 2: { open: 9.5, close: 9 } }),
  actions: ['buy', 'sell', ...holds(27)],
  expect: { returnPpm: -100000, returnPct: '-10.00', tradeCount: 2, hasValuation: false },
};

export const GAME_04 = {
  id: 'GAME-04',
  fillMode: 'next_open',
  bars: makeBars({
    2: { open: 10, close: 10 },
    3: { open: 11, close: 11 },
    4: { open: 10, close: 10 },
    5: { open: 9, close: 9 },
  }),
  actions: ['buy', 'sell', 'buy', 'sell', ...holds(25)],
  expect: { returnPpm: -10000, returnPct: '-1.00', tradeCount: 4, hasValuation: false },
};

export const GAME_05 = {
  id: 'GAME-05',
  fillMode: 'next_open',
  bars: makeBars({ 30: { open: 10, close: 11, high: 11.1, low: 9.9 } }),
  actions: [...holds(28), 'buy'],
  expect: {
    returnPpm: 100000,
    returnPct: '10.00',
    tradeCount: 1,
    hasValuation: true,
    valuation: { day: 30, price: 11, buyPrice: 10 },
  },
};

export const GAME_06 = {
  id: 'GAME-06',
  fillMode: 'same_close',
  bars: makeBars({
    29: { open: 10, close: 10 },
    30: { open: 9.5, close: 9, high: 9.6, low: 8.9 },
  }),
  actions: [...holds(28), 'buy'],
  expect: {
    returnPpm: -100000,
    returnPct: '-10.00',
    tradeCount: 1,
    hasValuation: true,
    valuation: { day: 30, price: 9, buyPrice: 10 },
  },
};

export const GAME_07_ILLEGAL = [
  {
    id: 'GAME-07-sell-flat',
    fillMode: 'next_open',
    bars: makeBars(),
    actions: ['sell', ...holds(28)],
  },
  {
    id: 'GAME-07-repeat-buy',
    fillMode: 'next_open',
    bars: makeBars({ 2: { open: 10, close: 10 }, 3: { open: 10, close: 10 } }),
    actions: ['buy', 'buy', ...holds(27)],
  },
  {
    id: 'GAME-07-illegal-enum',
    fillMode: 'same_close',
    bars: makeBars(),
    actions: ['hold', 'yoga', ...holds(27)],
  },
  {
    id: 'GAME-07-missing-days',
    fillMode: 'next_open',
    bars: makeBars(),
    actions: holds(10),
    finish: true,
  },
  {
    id: 'GAME-07-too-many-days',
    fillMode: 'next_open',
    bars: makeBars(),
    actions: holds(30),
    finish: true,
  },
];

export const GOLDEN_SETTLE = [GAME_01, GAME_02, GAME_03, GAME_04, GAME_05, GAME_06];
