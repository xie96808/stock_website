import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../js/state.js';
import { resetSession, getSession } from '../js/game-session.js';
import {
  hasGameWindowDto,
  mustAwaitPackBeforeEnter,
  isWellFormedGameWindowDto,
  validateGameWindowDtoShape,
  seedClassicFromWindow,
} from '../js/game-window-seed.js';

function ohlcv(n, volBase = 1000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = 10 + i * 0.01;
    out.push({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: c,
      high: c + 0.1,
      low: c - 0.1,
      close: c,
      volume: volBase + i,
    });
  }
  return out;
}

function classicWindow(overrides = {}) {
  const history = overrides.history ?? ohlcv(30, 500);
  const bars = overrides.bars ?? ohlcv(30, 900);
  return {
    v: 1,
    historyLength: history.length,
    gameDays: bars.length,
    history,
    bars,
    ...overrides,
  };
}

test('hasGameWindowDto requires non-empty window.bars (enter-gate)', () => {
  assert.equal(hasGameWindowDto(null), false);
  assert.equal(hasGameWindowDto({}), false);
  assert.equal(hasGameWindowDto({ window: null }), false);
  assert.equal(hasGameWindowDto({ window: { bars: [] } }), false);
  assert.equal(hasGameWindowDto({ window: { bars: 'nope' } }), false);
  assert.equal(hasGameWindowDto({ window: { history: ohlcv(30) } }), false);
  assert.equal(
    hasGameWindowDto({ window: { bars: ohlcv(30), history: ohlcv(30) } }),
    true
  );
  // Enter-gate is bars-only: incomplete shape still unblocks pack await.
  assert.equal(hasGameWindowDto({ window: { bars: [{ close: 1 }] } }), true);
});

test('mustAwaitPackBeforeEnter is inverse of hasGameWindowDto', () => {
  assert.equal(mustAwaitPackBeforeEnter(null), true);
  assert.equal(mustAwaitPackBeforeEnter({}), true);
  assert.equal(mustAwaitPackBeforeEnter({ window: { bars: [] } }), true);
  assert.equal(
    mustAwaitPackBeforeEnter({ window: classicWindow() }),
    false,
    'window DTO present → pack must not block enter'
  );
  // Daily cloud meta with window: same rule as classic start-flow.
  assert.equal(
    mustAwaitPackBeforeEnter({
      gameId: 'd1',
      gameKind: 'daily',
      window: classicWindow(),
    }),
    false
  );
  assert.equal(
    mustAwaitPackBeforeEnter({
      gameId: 'd1',
      gameKind: 'daily',
      stockIndex: 0,
      windowStartIndex: 30,
    }),
    true,
    'absent window → fall back to pack / ensureStocksLoaded await'
  );
});

test('validateGameWindowDtoShape / isWellFormedGameWindowDto reject malformed', () => {
  assert.equal(isWellFormedGameWindowDto(null), false);
  assert.equal(validateGameWindowDtoShape(null).reason, 'missing');
  assert.equal(validateGameWindowDtoShape({ bars: [] }).reason, 'bars');
  assert.equal(
    validateGameWindowDtoShape({ bars: ohlcv(30), history: 'x' }).reason,
    'history'
  );
  assert.equal(
    validateGameWindowDtoShape({
      v: 2,
      bars: ohlcv(30),
      history: ohlcv(30),
      gameDays: 30,
      historyLength: 30,
    }).reason,
    'bad_v'
  );
  assert.equal(
    validateGameWindowDtoShape({
      bars: ohlcv(29),
      history: ohlcv(30),
      gameDays: 30,
      historyLength: 30,
    }).reason,
    'bars_length'
  );
  assert.equal(
    validateGameWindowDtoShape({
      bars: ohlcv(30),
      history: ohlcv(29),
      gameDays: 30,
      historyLength: 30,
    }).reason,
    'history_length'
  );
  const noVolBars = ohlcv(30).map(({ volume, ...rest }) => rest);
  assert.equal(
    validateGameWindowDtoShape({
      v: 1,
      bars: noVolBars,
      history: ohlcv(30),
      gameDays: 30,
      historyLength: 30,
    }).reason,
    'bars_ohlcv'
  );
  const noVolHist = ohlcv(30).map(({ volume, ...rest }) => rest);
  assert.equal(
    validateGameWindowDtoShape({
      v: 1,
      bars: ohlcv(30),
      history: noVolHist,
      gameDays: 30,
      historyLength: 30,
    }).reason,
    'history_ohlcv'
  );
  assert.equal(isWellFormedGameWindowDto(classicWindow()), true);
  assert.equal(validateGameWindowDtoShape(classicWindow()).ok, true);
});

test('seedClassicFromWindow works with empty catalog', () => {
  gameState.stocksData = [];
  resetSession({ practiceOnly: false, fillMode: 'next_open' });

  const history = ohlcv(30, 500);
  const bars = ohlcv(30, 900);
  seedClassicFromWindow({
    gameId: 'g-r5',
    stockCode: '600000',
    stockName: '测试股',
    fillMode: 'next_open',
    ruleVersion: 'sim30-mtm-v1',
    datasetVersion: 'ds',
    gameKind: 'classic',
    window: {
      v: 1,
      historyLength: 30,
      gameDays: 30,
      history,
      bars,
    },
  });

  const s = getSession();
  assert.equal(s.cloudMode, true);
  assert.equal(s.cloudGameId, 'g-r5');
  assert.equal(s.gameDays, 30);
  assert.equal(s.historyLength, 30);
  assert.equal(s.gameKline.length, 60);
  assert.equal(s.currentStock.code, '600000');
  assert.equal(s.gameKline[0].volume, 500);
  assert.equal(s.gameKline[30].volume, 900);
  assert.equal(gameState.stocksData.length, 0, 'catalog stays empty');
});

test('seedClassicFromWindow rejects length mismatch', () => {
  assert.throws(
    () =>
      seedClassicFromWindow({
        gameId: 'bad',
        window: { historyLength: 30, gameDays: 30, history: ohlcv(29), bars: ohlcv(30) },
      }),
    /历史窗口无效/
  );
  assert.throws(
    () =>
      seedClassicFromWindow({
        gameId: 'bad-bars',
        window: { historyLength: 30, gameDays: 30, history: ohlcv(30), bars: ohlcv(29) },
      }),
    /行情窗口无效/
  );
});

test('seedClassicFromWindow preserves daily gameKind', () => {
  gameState.stocksData = [];
  resetSession({ practiceOnly: false, fillMode: 'next_open' });
  seedClassicFromWindow({
    gameId: 'g-daily',
    stockCode: '000001',
    stockName: '日挑战',
    fillMode: 'next_open',
    gameKind: 'daily',
    window: classicWindow(),
  });
  const s = getSession();
  assert.equal(s.gameKind, 'daily');
  assert.equal(s.cloudGameId, 'g-daily');
  assert.equal(s.fillMode, 'next_open');
  assert.equal(gameState.stocksData.length, 0);
});

test('daily cloud with window seeds without catalog (R5)', () => {
  gameState.stocksData = [];
  resetSession({ practiceOnly: false, fillMode: 'next_open' });
  seedClassicFromWindow({
    gameId: 'daily-empty-pack',
    stockCode: '600519',
    stockName: '挑战股',
    gameKind: 'daily',
    fillMode: 'next_open',
    window: classicWindow({ history: ohlcv(30, 100), bars: ohlcv(30, 200) }),
  });
  const s = getSession();
  assert.equal(s.gameKind, 'daily');
  assert.equal(s.gameKline.length, 60);
  assert.equal(s.gameKline[0].volume, 100);
  assert.equal(s.gameKline[30].volume, 200);
  assert.equal(gameState.stocksData.length, 0);
  assert.equal(mustAwaitPackBeforeEnter({ window: classicWindow() }), false);
});
