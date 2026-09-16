import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER1_LEVEL_DEFS,
  CHAPTER2_LEVEL_DEFS,
  CHAPTER3_LEVEL_DEFS,
  CHAPTER4_LEVEL_DEFS,
  buildContextHistory,
  buildLevelSnapshot,
  PUZZLE_PUBLIC_STOCK_CODE,
  levelDefByKey,
} from '../server/src/lib/puzzleLevels.js';

test('buildContextHistory yields ordered bars ending near day-1 open', () => {
  const first = { open: 10, high: 10.5, low: 9.5, close: 10.2, volume: 1000 };
  const hist = buildContextHistory(first, 30);
  assert.equal(hist.length, 30);
  assert.equal(hist[hist.length - 1].close, 10);
  assert.ok(hist[0].date < hist[hist.length - 1].date);
});

test('buildLevelSnapshot includes real-pack history for all chapter-1 defs', () => {
  const opens = new Set();
  for (const def of CHAPTER1_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.ok(def.version >= 3, `${def.levelKey} version`);
    assert.ok(def.packRef && Number.isInteger(def.packRef.stockIndex));
    assert.ok(def.teachingBrief && def.openStateHint);
    assert.equal(def.stockCode, PUZZLE_PUBLIC_STOCK_CODE);
    opens.add(snapshot.bars[0].open);
  }
  // All chapter-1 levels published at v4 with differentiated star goals.
  for (const def of CHAPTER1_LEVEL_DEFS) {
    assert.equal(def.version, 4, `${def.levelKey} version`);
  }
  // ch1-01: early-cut 3★ only (beat≥8pp, MDD≤15%)
  assert.equal(CHAPTER1_LEVEL_DEFS[0].levelKey, 'ch1-01');
  assert.equal(CHAPTER1_LEVEL_DEFS[0].goals.twoStar.beatBuyHoldPp, 8);
  assert.equal(CHAPTER1_LEVEL_DEFS[0].goals.threeStar.maxMddPct, 15);
  // ch1-02…06 tightened thresholds (see contentNote / engine regressions)
  assert.equal(CHAPTER1_LEVEL_DEFS[1].goals.twoStar.beatBuyHoldPp, 20);
  assert.equal(CHAPTER1_LEVEL_DEFS[2].goals.threeStar.maxMddPct, 1);
  assert.equal(CHAPTER1_LEVEL_DEFS[3].goals.threeStar.minReturnPpm, 327000);
  assert.equal(CHAPTER1_LEVEL_DEFS[4].goals.threeStar.minReturnPpm, 0);
  assert.equal(CHAPTER1_LEVEL_DEFS[5].goals.twoStar.beatBuyHoldPp, 25);
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

test('buildLevelSnapshot includes real-pack history for all chapter-2 defs', () => {
  const opens = new Set();
  assert.equal(CHAPTER2_LEVEL_DEFS.length, 6);
  for (const def of CHAPTER2_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.equal(def.version, 1, `${def.levelKey} version`);
    assert.ok(def.packRef && Number.isInteger(def.packRef.stockIndex));
    assert.ok(def.teachingBrief && def.openStateHint);
    assert.equal(def.stockCode, PUZZLE_PUBLIC_STOCK_CODE);
    assert.ok(String(def.rewardFamilyId).startsWith('ch2-'));
    assert.equal(levelDefByKey(def.levelKey)?.levelKey, def.levelKey);
    opens.add(snapshot.bars[0].open);
  }
  assert.ok(opens.size >= 5, `expected distinct day1 opens, got ${[...opens]}`);
  assert.match(CHAPTER2_LEVEL_DEFS[0].title, /追高/);
  assert.match(CHAPTER2_LEVEL_DEFS[1].title, /回马枪/);
  assert.match(CHAPTER2_LEVEL_DEFS[2].title, /一枪/);
  assert.match(CHAPTER2_LEVEL_DEFS[3].title, /假突破/);
  assert.match(CHAPTER2_LEVEL_DEFS[4].title, /阴跌/);
  assert.match(CHAPTER2_LEVEL_DEFS[5].title, /逃顶/);
});

test('ch2 teachingBrief / goals readable; buy-hold not trivial 3★ path', async () => {
  const { formatLevelGoalLines } = await import('../js/puzzle-goals-copy.js');
  for (const def of CHAPTER2_LEVEL_DEFS) {
    const lines = formatLevelGoalLines(def.goals);
    assert.ok(lines.length >= 1, def.levelKey);
    assert.match(lines[0], /^二星：/);
    if (lines[1]) assert.match(lines[1], /^三星：/);
    assert.ok(def.goals?.twoStar?.beatBuyHoldPp >= 5, def.levelKey);
  }
});

test('buildLevelSnapshot includes real-pack history for all chapter-3 defs', () => {
  const opens = new Set();
  assert.equal(CHAPTER3_LEVEL_DEFS.length, 6);
  for (const def of CHAPTER3_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.equal(def.version, 1, `${def.levelKey} version`);
    assert.ok(def.packRef && Number.isInteger(def.packRef.stockIndex));
    assert.ok(def.teachingBrief && def.openStateHint);
    assert.equal(def.stockCode, PUZZLE_PUBLIC_STOCK_CODE);
    assert.ok(String(def.rewardFamilyId).startsWith('ch3-'));
    assert.equal(levelDefByKey(def.levelKey)?.levelKey, def.levelKey);
    assert.ok(Array.isArray(def.validatedThreeStarActions));
    assert.equal(def.validatedThreeStarActions.length, def.gameDays - 1);
    opens.add(snapshot.bars[0].open);
  }
  assert.ok(opens.size >= 5, `expected distinct day1 opens, got ${[...opens]}`);
  assert.match(CHAPTER3_LEVEL_DEFS[0].title, /缺口/);
  assert.match(CHAPTER3_LEVEL_DEFS[1].title, /支撑/);
  assert.match(CHAPTER3_LEVEL_DEFS[2].title, /诱多/);
  assert.match(CHAPTER3_LEVEL_DEFS[3].title, /缩量|阴跌/);
  assert.match(CHAPTER3_LEVEL_DEFS[4].title, /试错/);
  assert.match(CHAPTER3_LEVEL_DEFS[5].title, /末日/);
});

test('ch3 teachingBrief / goals readable; buy-hold not trivial 3★ path', async () => {
  const { formatLevelGoalLines } = await import('../js/puzzle-goals-copy.js');
  for (const def of CHAPTER3_LEVEL_DEFS) {
    const lines = formatLevelGoalLines(def.goals);
    assert.ok(lines.length >= 1, def.levelKey);
    assert.match(lines[0], /^二星：/);
    if (lines[1]) assert.match(lines[1], /^三星：/);
    assert.ok(def.goals?.twoStar?.beatBuyHoldPp >= 5, def.levelKey);
  }
});

test('buildLevelSnapshot includes real-pack history for all chapter-4 defs', () => {
  const opens = new Set();
  assert.equal(CHAPTER4_LEVEL_DEFS.length, 6);
  for (const def of CHAPTER4_LEVEL_DEFS) {
    const { snapshot } = buildLevelSnapshot(def);
    assert.equal(snapshot.levelKey, def.levelKey);
    assert.equal(snapshot.bars.length, def.gameDays);
    assert.ok(snapshot.historyLength >= 20);
    assert.equal(snapshot.history.length, snapshot.historyLength);
    assert.equal(def.version, 1, `${def.levelKey} version`);
    assert.ok(def.packRef && Number.isInteger(def.packRef.stockIndex));
    assert.ok(def.teachingBrief && def.openStateHint);
    assert.equal(def.stockCode, PUZZLE_PUBLIC_STOCK_CODE);
    assert.ok(String(def.rewardFamilyId).startsWith('ch4-'));
    assert.equal(levelDefByKey(def.levelKey)?.levelKey, def.levelKey);
    assert.ok(Array.isArray(def.validatedThreeStarActions));
    assert.equal(def.validatedThreeStarActions.length, def.gameDays - 1);
    opens.add(snapshot.bars[0].open);
  }
  assert.ok(opens.size >= 5, `expected distinct day1 opens, got ${[...opens]}`);
  assert.match(CHAPTER4_LEVEL_DEFS[0].title, /涨停/);
  assert.match(CHAPTER4_LEVEL_DEFS[1].title, /假摔/);
  assert.match(CHAPTER4_LEVEL_DEFS[2].title, /回撤/);
  assert.match(CHAPTER4_LEVEL_DEFS[3].title, /双顶/);
  assert.match(CHAPTER4_LEVEL_DEFS[4].title, /真空|磨人/);
  assert.match(CHAPTER4_LEVEL_DEFS[5].title, /回吐/);
});

test('ch4 teachingBrief / goals readable; buy-hold not trivial 3★ path', async () => {
  const { formatLevelGoalLines } = await import('../js/puzzle-goals-copy.js');
  for (const def of CHAPTER4_LEVEL_DEFS) {
    const lines = formatLevelGoalLines(def.goals);
    assert.ok(lines.length >= 1, def.levelKey);
    assert.match(lines[0], /^二星：/);
    if (lines[1]) assert.match(lines[1], /^三星：/);
    assert.ok(def.goals?.twoStar?.beatBuyHoldPp >= 5, def.levelKey);
  }
});

