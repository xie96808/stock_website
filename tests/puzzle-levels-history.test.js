import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER1_LEVEL_DEFS,
  buildContextHistory,
  buildLevelSnapshot,
} from '../server/src/lib/puzzleLevels.js';

test('buildContextHistory yields ordered bars ending near day-1 open', () => {
  const first = { open: 10, high: 10.5, low: 9.5, close: 10.2, volume: 1000 };
  const hist = buildContextHistory(first, 30);
  assert.equal(hist.length, 30);
  assert.equal(hist[hist.length - 1].close, 10);
  assert.ok(hist[0].date < hist[hist.length - 1].date);
});

test('buildLevelSnapshot includes non-empty history for all chapter-1 defs', () => {
  for (const def of CHAPTER1_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.equal(def.version, 2);
  }
});
