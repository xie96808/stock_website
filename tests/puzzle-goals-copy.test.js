import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTwoStarGoalLine,
  formatThreeStarGoalLine,
  formatLevelGoalLines,
  formatPuzzlePlayTip,
} from '../js/puzzle-goals-copy.js';

const sampleGoals = {
  twoStar: { beatBuyHoldPp: 3 },
  threeStar: { maxMddPct: 30, maxOrders: 1 },
};

test('formatTwoStarGoalLine human-readable', () => {
  assert.equal(
    formatTwoStarGoalLine(sampleGoals),
    '二星：收益比买持好 ≥3 个百分点'
  );
  assert.equal(formatTwoStarGoalLine(null), null);
  assert.equal(formatTwoStarGoalLine({}), null);
});

test('formatThreeStarGoalLine human-readable', () => {
  assert.equal(
    formatThreeStarGoalLine(sampleGoals),
    '三星：回撤≤30% 且成交≤1笔'
  );
  assert.equal(
    formatThreeStarGoalLine({ threeStar: { maxMddPct: 12 } }),
    '三星：回撤≤12%'
  );
  assert.equal(formatThreeStarGoalLine(null), null);
});

test('formatLevelGoalLines both', () => {
  assert.deepEqual(formatLevelGoalLines(sampleGoals), [
    '二星：收益比买持好 ≥3 个百分点',
    '三星：回撤≤30% 且成交≤1笔',
  ]);
});

test('formatPuzzlePlayTip includes T+1 open-state and goals', () => {
  const tip = formatPuzzlePlayTip({
    goals: sampleGoals,
    openStateHint: '开局满仓且 T+1 锁定，首日不可卖',
    maxOrders: 1,
  });
  assert.match(tip, /T\+1/);
  assert.match(tip, /二星：收益比买持好/);
  assert.match(tip, /三星：回撤≤30%/);
});

test('formatPuzzlePlayTip falls back to maxOrders when no hint', () => {
  const tip = formatPuzzlePlayTip({
    goals: { twoStar: { beatBuyHoldPp: 5 } },
    maxOrders: 2,
  });
  assert.match(tip, /订单上限 2/);
  assert.match(tip, /≥5 个百分点/);
});
