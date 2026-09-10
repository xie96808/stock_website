import test from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../js/state.js';
import {
  CATALOG_KEY,
  SESSION_KEYS,
  getSession,
  getStocksCatalog,
  buildFreshSessionFields,
  resetSession,
  patchSession,
  applyEngineResult,
  clearShareMeta,
  setShareMeta,
  snapshotSession,
} from '../js/game-session.js';

function seedDirtySession() {
  gameState.stocksData = [{ code: 'AAA', name: 'Alpha', kline: [] }];
  gameState.currentStock = gameState.stocksData[0];
  gameState.gameKline = [{ date: '2020-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }];
  gameState.historyLength = 10;
  gameState.currentDay = 12;
  gameState.position = 'long';
  gameState.costBasis = 9.5;
  gameState.totalReturn = 1.23;
  gameState.tradeHistory = [{ type: 'buy', day: 2, price: 9.5, return: null }];
  gameState.valuation = { day: 30, price: 10, multiple: 1.05 };
  gameState.actions = ['buy', 'hold', 'hold'];
  gameState.pendingAction = 'sell';
  gameState.holdingDays = 4;
  gameState.tradeGains = [1.1];
  gameState.bsScore = 77;
  gameState.bestPoints = { buys: [{ day: 2 }], sells: [] };
  gameState.fillMode = 'same_close';
  gameState.lastBuyFillDay = 2;
  gameState.ruleVersion = 'old';
  gameState.returnPpm = 1234;
  gameState.returnPct = '1.23';
  gameState.cloudMode = true;
  gameState.cloudGameId = 'g-dirty';
  gameState.datasetVersion = 'ds';
  gameState.saveStatus = 'saved';
  gameState.saveError = 'x';
  gameState.practiceOnly = false;
  gameState.shareRank = 3;
  gameState.shareBoardTotal = 100;
  gameState.shareBeatPct = 97;
}

test('getSession preserves gameState object identity', () => {
  assert.equal(getSession(), gameState);
  assert.equal(getStocksCatalog(), gameState.stocksData);
  assert.equal(CATALOG_KEY, 'stocksData');
  assert.ok(SESSION_KEYS.includes('actions'));
  assert.ok(!SESSION_KEYS.includes('stocksData'));
});

test('resetSession restores start invariants and preserves catalog', () => {
  seedDirtySession();
  const catalogRef = gameState.stocksData;
  const stockRef = gameState.currentStock;
  const klineRef = gameState.gameKline;
  const shareRankBefore = gameState.shareRank;

  resetSession({ practiceOnly: true, fillMode: 'same_close' });

  assert.equal(gameState.stocksData, catalogRef, 'catalog identity preserved');
  assert.equal(gameState.stocksData.length, 1);
  // Historical startGame reset did not null seed/share fields — keep that.
  assert.equal(gameState.currentStock, stockRef);
  assert.equal(gameState.gameKline, klineRef);
  assert.equal(gameState.shareRank, shareRankBefore);

  assert.equal(gameState.currentDay, 1);
  assert.equal(gameState.position, 'empty');
  assert.equal(gameState.costBasis, 0);
  assert.equal(gameState.totalReturn, 1);
  assert.deepEqual(gameState.tradeHistory, []);
  assert.equal(gameState.pendingAction, null);
  assert.equal(gameState.holdingDays, 0);
  assert.deepEqual(gameState.tradeGains, []);
  assert.equal(gameState.historyLength, 0);
  assert.equal(gameState.bsScore, null);
  assert.equal(gameState.bestPoints, null);
  assert.equal(gameState.fillMode, 'same_close');
  assert.equal(gameState.lastBuyFillDay, null);
  assert.deepEqual(gameState.actions, []);
  assert.equal(gameState.valuation, null);
  assert.equal(gameState.returnPpm, null);
  assert.equal(gameState.returnPct, null);
  assert.equal(gameState.ruleVersion, 'sim30-mtm-v1');
  assert.equal(gameState.cloudMode, false);
  assert.equal(gameState.cloudGameId, null);
  assert.equal(gameState.datasetVersion, null);
  assert.equal(gameState.saveStatus, null);
  assert.equal(gameState.saveError, null);
  assert.equal(gameState.practiceOnly, true);
});

test('buildFreshSessionFields defaults match start bag', () => {
  const fresh = buildFreshSessionFields();
  assert.equal(fresh.fillMode, 'next_open');
  assert.equal(fresh.practiceOnly, false);
  assert.equal(fresh.ruleVersion, 'sim30-mtm-v1');
  assert.equal(fresh.currentDay, 1);
  assert.deepEqual(fresh.actions, []);
});

test('patchSession writes session keys and ignores catalog/unknown', () => {
  seedDirtySession();
  const catalogRef = gameState.stocksData;
  patchSession({
    currentDay: 5,
    position: 'locked',
    stocksData: [{ code: 'HACK' }],
    notAField: 1,
  });
  assert.equal(gameState.currentDay, 5);
  assert.equal(gameState.position, 'locked');
  assert.equal(gameState.stocksData, catalogRef);
  assert.equal(gameState.notAField, undefined);
});

test('applyEngineResult mid-game MTM and finished settle invariants', () => {
  resetSession({ fillMode: 'next_open' });
  patchSession({ actions: ['buy', 'hold'] });

  const bars = [];
  for (let i = 0; i < 30; i++) {
    bars.push({ open: 10, high: 11, low: 9, close: 10 + i * 0.1, volume: 1 });
  }

  applyEngineResult(
    {
      trades: [{ type: 'buy', day: 2, price: 10.1, return: null }],
      valuation: null,
      tradeGains: [],
      holdingDays: 1,
      ruleVersion: 'sim30-mtm-v1',
      rawPosition: 'long',
      costBasis: 10.1,
      buyFillDay: 2,
      buyPrice: 10.1,
      closedMultiple: 1,
    },
    { finished: false, bars },
  );

  // asOfDay = min(2+1, 30) = 3 → mark close = 10.2
  assert.equal(gameState.position, 'long');
  assert.equal(gameState.costBasis, 10.1);
  assert.equal(gameState.lastBuyFillDay, 2);
  assert.equal(gameState.returnPpm, null);
  assert.equal(gameState.returnPct, null);
  assert.ok(Math.abs(gameState.totalReturn - (10.2 / 10.1)) < 1e-12);
  assert.equal(gameState.tradeHistory.length, 1);
  assert.equal(gameState.tradeHistory[0].type, 'buy');

  applyEngineResult(
    {
      trades: [
        { type: 'buy', day: 2, price: 10.1, return: null },
        { type: 'sell', day: 5, price: 11, return: 11 / 10.1 },
      ],
      valuation: null,
      tradeGains: [11 / 10.1],
      holdingDays: 3,
      ruleVersion: 'sim30-mtm-v1',
      equityMultiple: 1.0891089108910892,
      returnPpm: 89108,
      returnPct: '8.91',
    },
    { finished: true, bars },
  );

  assert.equal(gameState.position, 'empty');
  assert.equal(gameState.costBasis, 0);
  assert.equal(gameState.lastBuyFillDay, null);
  assert.equal(gameState.returnPpm, 89108);
  assert.equal(gameState.returnPct, '8.91');
  assert.equal(gameState.totalReturn, 1.0891089108910892);
  assert.equal(gameState.holdingDays, 3);
  assert.equal(gameState.tradeHistory.length, 2);
});

test('clearShareMeta / setShareMeta round-trip', () => {
  setShareMeta({ rank: 2, boardTotal: 50, beatPct: 96 });
  assert.equal(gameState.shareRank, 2);
  assert.equal(gameState.shareBoardTotal, 50);
  assert.equal(gameState.shareBeatPct, 96);
  clearShareMeta();
  assert.equal(gameState.shareRank, null);
  assert.equal(gameState.shareBoardTotal, null);
  assert.equal(gameState.shareBeatPct, null);
});

test('snapshotSession returns session keys only', () => {
  resetSession();
  const snap = snapshotSession();
  for (const k of SESSION_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(snap, k), k);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(snap, 'stocksData'), false);
});
