import test from 'node:test';
import assert from 'node:assert/strict';
import {
  starsGlyph,
  renderStarIcons,
  stripStarPrefix,
  formatEdgeVsBuyHold,
  formatThreeStarSummary,
  formatTwoStarSummary,
  formatPuzzleSettleModal,
} from '../js/puzzle-settle-copy.js';

test('starsGlyph: pending avoids fake 1★', () => {
  assert.deepEqual(
    { glyph: starsGlyph(null, { pending: true }).glyph, starN: null, pending: true },
    { glyph: '…', starN: null, pending: true }
  );
  assert.equal(starsGlyph(undefined).pending, true);
  assert.equal(starsGlyph(3).glyph, '★★★');
  assert.equal(starsGlyph(2).glyph, '★★☆');
  assert.equal(starsGlyph(1).glyph, '★☆☆');
  assert.equal(starsGlyph(0).glyph, '☆☆☆');
  assert.equal(starsGlyph(3).ariaLabel, '三星');
  assert.equal(starsGlyph(1).ariaLabel, '一星');
});

test('renderStarIcons: CSS icon row with aria-label', () => {
  const r3 = renderStarIcons(3);
  assert.equal(r3.ariaLabel, '三星');
  assert.match(r3.html, /aria-label="三星"/);
  assert.equal((r3.html.match(/puzzle-star--on/g) || []).length, 3);
  const r1 = renderStarIcons(1);
  assert.equal(r1.ariaLabel, '一星');
  assert.equal((r1.html.match(/puzzle-star--on/g) || []).length, 1);
  assert.equal((r1.html.match(/class="puzzle-star"/g) || []).length, 2);
  const pending = renderStarIcons(null, { pending: true });
  assert.equal(pending.pending, true);
  assert.match(pending.html, /星级结算中/);
});

test('stripStarPrefix removes text star prefixes', () => {
  assert.equal(stripStarPrefix('1★ 合法完成'), '合法完成');
  assert.equal(stripStarPrefix('二星：收益比买持好 ≥3 个百分点'), '收益比买持好 ≥3 个百分点');
  assert.equal(stripStarPrefix('三星：回撤≤30% 且成交≤1笔'), '回撤≤30% 且成交≤1笔');
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
  assert.equal(formatTwoStarSummary(goals), '二星：收益比买持好 ≥3 个百分点');
  assert.equal(formatThreeStarSummary(goals), '三星：回撤≤30% 且成交≤1笔');
  assert.equal(formatThreeStarSummary(null), null);
});

test('formatPuzzleSettleModal pending', () => {
  const c = formatPuzzleSettleModal({ status: 'pending' });
  assert.equal(c.status, 'pending');
  assert.equal(c.starsGlyph, '…');
  assert.equal(c.starN, null);
  assert.match(c.starsHtml, /puzzle-stars--pending|星级结算中/);
  assert.match(c.headline, /保存|结算/);
  assert.ok(c.goalItems.length >= 2);
  assert.ok(c.goalLines.length >= 2);
  assert.ok(!c.goalLines.some((l) => /1★|2★|3★/.test(l)));
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
  assert.equal(c.starsAriaLabel, '三星');
  assert.match(c.starsHtml, /aria-label="三星"/);
  assert.equal((c.starsHtml.match(/puzzle-star--on/g) || []).length, 3);
  assert.equal(c.title, '残局结算');
  assert.equal(c.rewardGranted, true);
  assert.equal(c.rewardAmount, 20);
  assert.match(c.headline, /三星/);
  assert.ok(c.goalItems.every((g) => g.met === true));
  assert.ok(c.goalItems.some((g) => g.label === '合法完成'));
  assert.ok(c.goalItems.some((g) => g.label.includes('收益比买持') && !g.label.includes('二星')));
  assert.ok(c.goalItems.some((g) => g.label.includes('回撤') && !/^三星/.test(g.label)));
  assert.ok(c.goalLines.some((l) => l.includes('✓') && l.includes('合法完成')));
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
  assert.match(c.rewardLine, /已领/);
});

test('formatPuzzleSettleModal ok 1★ no reward uses icon + condition labels', () => {
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
  assert.equal(c.starsAriaLabel, '一星');
  assert.equal((c.starsHtml.match(/puzzle-star--on/g) || []).length, 1);
  assert.match(c.rewardLine, /未达二星/);
  assert.ok(!/≥2★/.test(c.rewardLine));
  assert.equal(c.goalItems[0].met, true);
  assert.equal(c.goalItems[1].met, false);
  assert.ok(c.goalLines.some((l) => l.startsWith('○') && l.includes('收益比买持')));
  assert.match(c.headline, /一星/);
  assert.ok(!c.headline.includes('1★'));
});
