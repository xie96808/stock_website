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

test('ch1-01 v4 day1-sell validated route scores 3★', () => {
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
  // ~ -10% vs buy-hold ~ -32% ⇒ beat by ≥8pp; MDD ~10% ≤15%
  assert.ok(s.edgePpm >= 8 * 10000);
  assert.ok(best.mddPpm <= 150_000);
});

test('ch1-01 day2-sell scores 2★ (edge≥8 but MDD>~15%)', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  assert.equal(def.goals.twoStar.beatBuyHoldPp, 8);
  assert.equal(def.goals.threeStar.maxMddPct, 15);
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const settled = settlePuzzle({
    bars: def.bars,
    actions: ['hold', 'sell', 'hold', 'hold', 'hold'],
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(settled.ok, true, settled.message);
  const s = scorePuzzleStars({
    returnPpm: settled.returnPpm,
    mddPpm: settled.mddPpm,
    orderCount: settled.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.stars, 2);
  assert.equal(s.twoStarMet, true);
  assert.equal(s.threeStarMet, false);
  assert.ok(s.edgePpm >= 8 * 10000);
  assert.ok(settled.mddPpm > 150_000);
});

test('ch1-01 day4-sell scores 1★ (edge ~3.7pp < 8pp → not 3★)', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const settled = settlePuzzle({
    bars: def.bars,
    actions: ['hold', 'hold', 'hold', 'sell', 'hold'],
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(settled.ok, true, settled.message);
  const s = scorePuzzleStars({
    returnPpm: settled.returnPpm,
    mddPpm: settled.mddPpm,
    orderCount: settled.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.stars, 1);
  assert.equal(s.twoStarMet, false);
  assert.equal(s.threeStarMet, false);
  assert.ok(s.edgePpm < 8 * 10000);
  assert.ok(s.edgePpm > 0);
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

test('scorePuzzleStars thresholds: exactly at / just below beatBuyHoldPp', () => {
  const goals = {
    twoStar: { beatBuyHoldPp: 3 },
    threeStar: { maxMddPct: 30, maxOrders: 1 },
  };
  // edgePpm = returnPpm - benchmark; threshold = 3pp = 30000 ppm
  const at = scorePuzzleStars({
    returnPpm: 30_000,
    mddPpm: 100_000,
    orderCount: 1,
    benchmarkReturnPpm: 0,
    goals,
  });
  assert.equal(at.stars, 3);
  assert.equal(at.edgePpm, 30_000);
  assert.equal(at.twoStarMet, true);

  const justBelow = scorePuzzleStars({
    returnPpm: 29_999,
    mddPpm: 100_000,
    orderCount: 1,
    benchmarkReturnPpm: 0,
    goals,
  });
  assert.equal(justBelow.stars, 1);
  assert.equal(justBelow.twoStarMet, false);
  assert.equal(justBelow.threeStarMet, false);
  assert.equal(justBelow.edgePpm, 29_999);
});

test('scorePuzzleStars MDD bounds: at / just over maxMddPct', () => {
  const goals = {
    twoStar: { beatBuyHoldPp: 3 },
    threeStar: { maxMddPct: 30, maxOrders: 2 },
  };
  const atCap = scorePuzzleStars({
    returnPpm: 50_000,
    mddPpm: 300_000, // exactly 30%
    orderCount: 1,
    benchmarkReturnPpm: 0,
    goals,
  });
  assert.equal(atCap.stars, 3);

  const over = scorePuzzleStars({
    returnPpm: 50_000,
    mddPpm: 300_001,
    orderCount: 1,
    benchmarkReturnPpm: 0,
    goals,
  });
  assert.equal(over.stars, 2);
  assert.equal(over.twoStarMet, true);
  assert.equal(over.threeStarMet, false);
});

test('returnPpm / edgePpm vs buy-hold: hold-only edge is ~0 for starting long', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const hold = settlePuzzle({
    bars: def.bars,
    actions: holds(def.gameDays - 1),
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(hold.ok, true);
  assert.equal(hold.returnPpm, bh);
  const s = scorePuzzleStars({
    returnPpm: hold.returnPpm,
    mddPpm: hold.mddPpm,
    orderCount: hold.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.edgePpm, 0);
  // beatBuyHoldPp is 8 → edge 0 fails 2★
  assert.equal(s.stars, 1);
});

test('ch1-01 sell-day1: next_open fill price, ~-10% return, 3★', () => {
  const def = CHAPTER1_LEVEL_DEFS[0];
  assert.equal(def.levelKey, 'ch1-01');
  const bh = puzzleBuyHoldBenchmarkPpm({ bars: def.bars, initialState: def.initialState });
  const best = settlePuzzle({
    bars: def.bars,
    actions: ['sell', 'hold', 'hold', 'hold', 'hold'],
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(best.ok, true, best.message);
  assert.equal(best.fillMode, 'next_open');
  assert.equal(best.trades.length, 1);
  assert.equal(best.trades[0].type, 'sell');
  // Decision day 1 → fill day 2 open
  assert.equal(best.trades[0].day, 2);
  assert.equal(best.trades[0].price, def.bars[1].open);
  assert.equal(best.trades[0].price, 32.14);

  // qty * day1 open = takeover NAV
  const init = normalizeInitialState(def.initialState, def.bars);
  assert.ok(Math.abs(init.takeoverNav - def.initialState.qty * def.bars[0].open) < 1e-9);

  // Sell at 32.14 vs takeover 35.71 → cash/nav ≈ 32.14/35.71 − 1 ≈ -9.997% → ~-10%
  const expectedReturn = (32.14 / 35.71 - 1) * 1e6;
  assert.ok(Math.abs(best.returnPpm - expectedReturn) < 2, `returnPpm ${best.returnPpm} vs ${expectedReturn}`);
  assert.ok(best.returnPpm > -110_000 && best.returnPpm < -90_000);

  const s = scorePuzzleStars({
    returnPpm: best.returnPpm,
    mddPpm: best.mddPpm,
    orderCount: best.orderCount,
    benchmarkReturnPpm: bh,
    goals: def.goals,
  });
  assert.equal(s.stars, 3);
  assert.equal(s.edgePpm, best.returnPpm - bh);
  assert.ok(s.edgePpm >= 8 * 10000);
  assert.ok(best.mddPpm <= 150_000);
  assert.equal(best.orderCount, 1);
});

test('qty * price NAV conservation on flat buy fill next_open', () => {
  const def = CHAPTER1_LEVEL_DEFS[2]; // starting flat
  assert.equal(def.initialState.qty, 0);
  const mid = settlePuzzle({
    bars: def.bars,
    actions: ['buy', ...holds(def.gameDays - 2)],
    initialState: def.initialState,
    maxOrders: def.maxOrders,
  });
  assert.equal(mid.ok, true, mid.message);
  assert.equal(mid.trades[0].type, 'buy');
  assert.equal(mid.trades[0].day, 2);
  assert.equal(mid.trades[0].price, def.bars[1].open);
  // After buy-all at next open, cash ~0 and qty * fill ≈ prior cash (takeover NAV)
  const init = normalizeInitialState(def.initialState, def.bars);
  assert.equal(init.takeoverNav, def.initialState.cash);
  // Final NAV from returnPpm: takeover * (1 + returnPpm/1e6)
  const finalNav = init.takeoverNav * (1 + mid.returnPpm / 1e6);
  // Mark-to-market at last close while holding
  const lastClose = def.bars[def.bars.length - 1].close;
  const fill = def.bars[1].open;
  const qty = def.initialState.cash / fill;
  const expectedNav = qty * lastClose;
  assert.ok(Math.abs(finalNav - expectedNav) / expectedNav < 1e-6);
});
