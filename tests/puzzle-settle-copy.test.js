import test from 'node:test';
import assert from 'node:assert/strict';
import {
  starsGlyph,
  formatEdgeVsBuyHold,
  formatThreeStarSummary,
  formatTwoStarSummary,
  formatPuzzleSettleModal,
} from '../js/puzzle-settle-copy.js';

test('starsGlyph: pending avoids fake 1★', () => {
  assert.deepEqual(starsGlyph(null, { pending: true }), {
    glyph: '…',
    starN: null,
    pending: true,
  });
  assert.deepEqual(starsGlyph(undefined), {
    glyph: '…',
    starN: null,
    pending: true,
  });
  assert.equal(starsGlyph(3).glyph, '★★★');
  assert.equal(starsGlyph(2).glyph, '★★☆');
  assert.equal(starsGlyph(1).glyph, '★☆☆');
  assert.equal(starsGlyph(0).glyph, '☆☆☆');
});

test('formatEdgeVsBuyHold', () => {
  assert.equal(formatEdgeVsBuyHold(null), null);
  assert.equal(formatEdgeVsBuyHold(50000), '相对买入持有 +5.00pp');
  assert.equal(formatEdgeVsBuyHold(-12300), '相对买入持有 -1.23pp');
  assert.equal(formatEdgeVsBuyHold(0), '相对买入持有持平');
});

test('goal summaries from goals DTO', () => {
  const goals = {
    twoStar: { beatBuyHoldPp: 3 },
    threeStar: { maxMddPct: 30, maxOrders: 1 },
  };
  assert.equal(formatTwoStarSummary(goals), '二星：相对买入持有至少 +3pp');
  assert.equal(formatThreeStarSummary(goals), '三星条件：回撤≤30% · 下单≤1次');
  assert.equal(formatThreeStarSummary(null), null);
});

test('formatPuzzleSettleModal pending', () => {
  const c = formatPuzzleSettleModal({ status: 'pending' });
  assert.equal(c.status, 'pending');
  assert.equal(c.starsGlyph, '…');
  assert.equal(c.starN, null);
  assert.match(c.headline, /保存|结算/);
  assert.ok(c.goalLines.length >= 2);
  assert.equal(c.rewardGranted, false);
});

test('formatPuzzleSettleModal fail does not claim reward', () => {
  const c = formatPuzzleSettleModal({
    status: 'fail',
    saveError: '网络异常',
  });
  assert.equal(c.status, 'fail');
  assert.equal(c.starsGlyph, '…');
  assert.equal(c.rewardGranted, false);
  assert.equal(c.rewardLine, null);
  assert.match(c.failNote, /未发放|未能写入/);
  assert.match(c.failNote, /网络异常/);
});

test('formatPuzzleSettleModal ok 3★ first clear', () => {
  const c = formatPuzzleSettleModal({
    status: 'ok',
    puzzleResult: {
      stars: 3,
      twoStarMet: true,
      threeStarMet: true,
      edgePpm: 82000,
      goals: {
        twoStar: { beatBuyHoldPp: 3 },
        threeStar: { maxMddPct: 30, maxOrders: 1 },
      },
      reward: { grantedThisTime: true, amount: 20, alreadyClaimed: true },
    },
  });
  assert.equal(c.starsGlyph, '★★★');
  assert.equal(c.starN, 3);
  assert.equal(c.rewardGranted, true);
  assert.equal(c.rewardAmount, 20);
  assert.match(c.headline, /三星/);
  assert.ok(c.goalLines.some((l) => l.includes('✓') && l.includes('1★')));
  assert.ok(c.goalLines.some((l) => l.includes('✓') && l.includes('2★')));
  assert.ok(c.goalLines.some((l) => l.includes('三星条件')));
  assert.equal(c.edgeLine, '相对买入持有 +8.20pp');
});

test('formatPuzzleSettleModal ok already claimed', () => {
  const c = formatPuzzleSettleModal({
    status: 'ok',
    puzzleResult: {
      stars: 3,
      twoStarMet: true,
      threeStarMet: true,
      reward: { grantedThisTime: false, amount: 0, alreadyClaimed: true },
    },
  });
  assert.equal(c.rewardGranted, false);
  assert.match(c.rewardLine, /已领取/);
});

test('formatPuzzleSettleModal ok 1★ no reward', () => {
  const c = formatPuzzleSettleModal({
    status: 'ok',
    puzzleResult: {
      stars: 1,
      twoStarMet: false,
      threeStarMet: false,
      goals: { twoStar: { beatBuyHoldPp: 3 }, threeStar: { maxMddPct: 30, maxOrders: 1 } },
      reward: { grantedThisTime: false, amount: 0, alreadyClaimed: false },
    },
  });
  assert.equal(c.starsGlyph, '★☆☆');
  assert.match(c.rewardLine, /未达二星/);
  assert.ok(c.goalLines.some((l) => l.startsWith('○') && l.includes('二星')));
});
