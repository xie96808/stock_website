import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER1_LEVEL_DEFS,
  buildContextHistory,
  buildLevelSnapshot,
  PUZZLE_PUBLIC_STOCK_CODE,
} from '../server/src/lib/puzzleLevels.js';

test('buildContextHistory yields ordered bars ending near day-1 open', () => {
  const first = { open: 10, high: 10.5, low: 9.5, close: 10.2, volume: 1000 };
  const hist = buildContextHistory(first, 30);
  assert.equal(hist.length, 30);
  assert.equal(hist[hist.length - 1].close, 10);
  assert.ok(hist[0].date < hist[hist.length - 1].date);
});

test('buildLevelSnapshot includes real-pack history for all chapter-1 defs (v3)', () => {
  const opens = new Set();
  for (const def of CHAPTER1_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.equal(def.version, 3);
    assert.ok(def.packRef && Number.isInteger(def.packRef.stockIndex));
    assert.ok(def.teachingBrief && def.openStateHint);
    assert.equal(def.stockCode, PUZZLE_PUBLIC_STOCK_CODE);
    opens.add(snapshot.bars[0].open);
  }
  // Distinct real windows — not identical synthetic junk.
  assert.ok(opens.size >= 5, `expected distinct day1 opens, got ${[...opens]}`);
});

test('ch1-02…06 teachingBrief each teach one clear lesson; goals format readable', async () => {
  const { formatLevelGoalLines } = await import('../js/puzzle-goals-copy.js');
  const byKey = Object.fromEntries(CHAPTER1_LEVEL_DEFS.map((d) => [d.levelKey, d]));
  assert.match(byKey['ch1-02'].teachingBrief, /落袋|浮盈/);
  assert.match(byKey['ch1-03'].teachingBrief, /两笔|第三笔/);
  assert.match(byKey['ch1-04'].teachingBrief, /T\+1/);
  assert.match(byKey['ch1-04'].openStateHint, /T\+1/);
  assert.match(byKey['ch1-05'].teachingBrief, /少动|震荡/);
  assert.match(byKey['ch1-06'].teachingBrief, /末日|短窗/);
  for (const def of CHAPTER1_LEVEL_DEFS) {
    const lines = formatLevelGoalLines(def.goals);
    assert.ok(lines.length >= 1, def.levelKey);
    assert.match(lines[0], /^二星：/);
    if (lines[1]) assert.match(lines[1], /^三星：/);
  }
});
