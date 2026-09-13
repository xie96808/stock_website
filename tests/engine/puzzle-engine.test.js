import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replayPuzzle,
  settlePuzzle,
  puzzleBuyHoldBenchmarkPpm,
  scorePuzzleStars,
  normalizeInitialState,
  PUZZLE_RULE_VERSION,
} from '../../shared/puzzleEngine.js';
import { CHAPTER1_LEVEL_DEFS } from '../../server/src/lib/puzzleLevels.js';

function holds(n) {
  return Array.from({ length: n }, () => 'hold');
}

test('puzzle rule version', () => {
  assert.equal(PUZZLE_RULE_VERSION, 'puzzle-mtm-v1');
});

test('initial funds conservation / takeover NAV matches open mark', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  const init = normalizeInitialState(def.initialState, def.bars);
  assert.equal(init.ok, true);
  assert.equal(init.takeoverMark, def.bars[0].open);
  assert.ok(Math.abs(init.takeoverNav - (def.initialState.cash + def.initialState.qty * def.bars[0].open)) < 1e-9);
  assert.ok(init.bookValue > 0);
  // Flat level conserves cash book
  const flat = CHAPTER1_LEVEL_DEFS[2];
  const f = normalizeInitialState(flat.initialState, flat.bars);
  assert.equal(f.bookValue, flat.initialState.cash);
  assert.equal(f.takeoverNav, flat.initialState.cash);
});

test('T+1 lock: day1 sell rejected on locked lot (ch1-04)', () => {
  const def = CHAPTER1_LEVEL_DEFS[3];
  const r = settlePuzzle({
    bars: def.bars,
    actions: ['sell', ...holds(def.gameDays - 2)],
    initialState: def.initialState,
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /firstSellableDay|T\+1/);
});

test('order budget rejects 3rd trade without mutating', () => {
  const def = CHAPTER1_LEVEL_DEFS[2];
  const mid = replayPuzzle({
    bars: def.bars,
    actions: ['buy', 'sell'],
    initialState: def.initialState,
    maxOrders: 2,
    finish: false,
  });
  assert.equal(mid.ok, true);
  assert.equal(mid.orderCount, 2);
  const cashAfterTwo = mid.cash;
  const bad = replayPuzzle({
    bars: def.bars,
    actions: ['buy', 'sell', 'buy'],
    initialState: def.initialState,
    maxOrders: 2,
    finish: false,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.stateUnchanged, true);
  assert.equal(bad.rejected, true);
  // Replaying only two trades still yields same cash (no mutation from rejected 3rd)
  const again = replayPuzzle({
    bars: def.bars,
    actions: ['buy', 'sell'],
    initialState: def.initialState,
    maxOrders: 2,
    finish: false,
  });
  assert.equal(again.cash, cashAfterTwo);
});

test('star scoring 1/2/3 for chapter levels', () => {
  for (const def of CHAPTER1_LEVEL_DEFS) {
    const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
    const holdOnly = settlePuzzle({
      bars: def.bars,
      actions: holds(def.gameDays - 1),
      initialState: def.initialState,
      maxOrders: def.maxOrders,
    });
    assert.equal(holdOnly.ok, true, def.levelKey + ' hold');
    const s1 = scorePuzzleStars({
      returnPpm: holdOnly.returnPpm,
      mddPpm: holdOnly.mddPpm,
      orderCount: holdOnly.orderCount,
      benchmarkReturnPpm: bh,
      goals: def.goals,
    });
    assert.ok(s1.stars >= 1);

    const best = settlePuzzle({
      bars: def.bars,
      actions: def.validatedThreeStarActions,
      initialState: def.initialState,
      maxOrders: def.maxOrders,
    });
    assert.equal(best.ok, true, `${def.levelKey} ${best.message}`);
    const s3 = scorePuzzleStars({
      returnPpm: best.returnPpm,
      mddPpm: best.mddPpm,
      orderCount: best.orderCount,
      benchmarkReturnPpm: bh,
      goals: def.goals,
    });
    assert.equal(s3.stars, 3, `${def.levelKey} expect 3 got ${s3.stars} edge=${best.returnPpm - bh} mdd=${best.mddPpm}`);
  }
});

test('1★ only when settle legal but miss two-star goal', () => {
  const def = CHAPTER1_LEVEL_DEFS[1]; // 到手的利润 — holding through dumps misses 2★
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const r = settlePuzzle({
    bars: def.bars,
    actions: holds(def.gameDays - 1),
    initialState: def.initialState,
  });
  const s = scorePuzzleStars({
    returnPpm: r.returnPpm,
    mddPpm: r.mddPpm,
    orderCount: r.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.stars, 1);
  assert.equal(s.twoStarMet, false);
});

test('buy-hold benchmark: starting long holds to last close', () => {
  const def = CHAPTER1_LEVEL_DEFS[0]; // long initial
  assert.ok(def.initialState.qty > 0);
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  // Starting long: hold-only settle must match buy-hold benchmark.
  const hold = settlePuzzle({
    bars: def.bars,
    actions: holds(def.gameDays - 1),
    initialState: def.initialState,
  });
  assert.equal(hold.ok, true);
  assert.equal(hold.returnPpm, bh);
  assert.ok(typeof bh === 'number');
  assert.ok(bh < 0); // underwater window
});

test('buy-hold benchmark: starting flat buys day2 open', () => {
  const def = CHAPTER1_LEVEL_DEFS[2]; // flat
  assert.equal(def.initialState.qty, 0);
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const holdBuy = settlePuzzle({
    bars: def.bars,
    actions: ['buy', ...holds(def.gameDays - 2)],
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(holdBuy.ok, true);
  assert.equal(holdBuy.returnPpm, bh);
});

test('ch1-01 v3 day1-sell validated route scores 3★', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  assert.deepEqual(def.validatedThreeStarActions, ['sell', 'hold', 'hold', 'hold', 'hold']);
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const best = settlePuzzle({
    bars: def.bars,
    actions: def.validatedThreeStarActions,
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(best.ok, true, best.message);
  const s = scorePuzzleStars({
    returnPpm: best.returnPpm,
    mddPpm: best.mddPpm,
    orderCount: best.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.stars, 3);
  assert.equal(s.twoStarMet, true);
  assert.equal(s.threeStarMet, true);
  // ~ -10% vs buy-hold ~ -32% ⇒ beat by ≥3pp
  assert.ok(s.edgePpm >= 3 * 10000);
});

test('2★ when beat buy-hold but fail three-star MDD/order caps', () => {
  const s = scorePuzzleStars({
    returnPpm: 50_000, // +5%
    mddPpm: 400_000, // 40% MDD
    orderCount: 3,
    benchmarkReturnPpm: 0,
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 30, maxOrders: 1 },
    },
  });
  assert.equal(s.stars, 2);
  assert.equal(s.twoStarMet, true);
  assert.equal(s.threeStarMet, false);
});

test('3★ requires beat + MDD/order caps', () => {
  const s = scorePuzzleStars({
    returnPpm: 50_000,
    mddPpm: 100_000,
    orderCount: 1,
    benchmarkReturnPpm: 0,
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 30, maxOrders: 1 },
    },
  });
  assert.equal(s.stars, 3);
});
