import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../js/state.js';
import { resetSession, getSession } from '../js/game-session.js';
import { hasGameWindowDto, seedClassicFromWindow } from '../js/game-window-seed.js';

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

test('hasGameWindowDto requires window.bars', () => {
  assert.equal(hasGameWindowDto(null), false);
  assert.equal(hasGameWindowDto({}), false);
  assert.equal(hasGameWindowDto({ window: { bars: [] } }), false);
  assert.equal(hasGameWindowDto({ window: { bars: ohlcv(30), history: ohlcv(30) } }), true);
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
});
