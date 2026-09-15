import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTwoStarGoalLine,
  formatThreeStarGoalLine,
  formatLevelGoalLines,
  formatPuzzlePlayTip,
  formatPuzzleRemainLabel,
  formatPlayHudChrome,
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
  assert.equal(
    formatThreeStarGoalLine({ threeStar: { maxMddPct: 8, maxOrders: 1, minReturnPpm: 327000 } }),
    '三星：回撤≤8% 且成交≤1笔 且收益≥32.7%'
  );
  assert.equal(
    formatThreeStarGoalLine({ threeStar: { minReturnPpm: 0 } }),
    '三星：收益≥0%'
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

test('formatPuzzleRemainLabel counts remaining window days', () => {
  assert.equal(formatPuzzleRemainLabel(1, 6), '余 5 日');
  assert.equal(formatPuzzleRemainLabel(6, 6), '本日结算');
  assert.equal(formatPuzzleRemainLabel(7, 6), '本日结算');
});

test('formatPlayHudChrome differentiates puzzle vs classic', () => {
  const classic = formatPlayHudChrome({ gameKind: 'classic' });
  assert.equal(classic.isPuzzle, false);
  assert.equal(classic.badge, '模拟盘');
  assert.equal(classic.dayLead, '第');
  assert.equal(classic.dayUnit, '天');
  assert.equal(classic.remainLabel, '');
  assert.equal(classic.boardKicker, 'SOUL PORTFOLIO');

  const puzzle = formatPlayHudChrome({
    gameKind: 'puzzle',
    title: '第一天站岗',
    theme: '买入后已有浮亏',
    currentDay: 2,
    gameDays: 6,
  });
  assert.equal(puzzle.isPuzzle, true);
  assert.equal(puzzle.badge, '残局');
  assert.equal(puzzle.subtitle, '第一天站岗 · 买入后已有浮亏');
  assert.equal(puzzle.dayLead, '窗口');
  assert.equal(puzzle.dayUnit, '日');
  assert.equal(puzzle.remainLabel, '余 4 日');
  assert.equal(puzzle.boardKicker, 'PUZZLE · 残局');
  assert.equal(puzzle.stageTitle, '短窗走势');
  assert.match(puzzle.mood, /残局挑战/);
});

