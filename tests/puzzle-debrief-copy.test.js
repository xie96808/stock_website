import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ppmToPctString,
  formatSignedPp,
  formatBuyHoldCompare,
  formatStarBreakdown,
  describeOpenSituation,
  describeTradePath,
  formatSituationNarrative,
  formatPuzzleDebrief,
  PUZZLE_BS_NOTE,
} from '../js/puzzle-debrief-copy.js';

const BANNED = [
  '记住：',
  '记住',
  '关键在于',
  '值得注意的是',
  '应止损',
  '完美操作',
  '加油',
  '你真棒',
  '继续努力',
];

function assertNoBannedTone(text) {
  const s = String(text || '');
  for (const b of BANNED) {
    assert.ok(!s.includes(b), `tone ban hit: ${b} in «${s}»`);
  }
}

test('ppm helpers', () => {
  assert.equal(ppmToPctString(null), null);
  assert.equal(ppmToPctString(50000), '5.00');
  assert.equal(ppmToPctString(-321400), '-32.14');
  assert.equal(formatSignedPp(30600), '+3.06');
  assert.equal(formatSignedPp(-12300), '-1.23');
  assert.equal(formatSignedPp(0), '0.00');
});

test('formatBuyHoldCompare fills numbers and desk paragraph', () => {
  const c = formatBuyHoldCompare({
    returnPpm: -321400,
    benchmarkReturnPpm: -352000,
    edgePpm: 30600,
  });
  assert.equal(c.yourReturnPct, '-32.14');
  assert.equal(c.buyHoldReturnPct, '-35.20');
  assert.equal(c.edgePp, '+3.06');
  assert.match(c.summaryLine, /-32\.14%.*-35\.20%.*\+3\.06pp/);
  assert.match(c.paragraph, /本窗你的收益率约 -32\.14%/);
  assert.match(c.paragraph, /买入持有约 -35\.20%/);
  assert.match(c.paragraph, /多出 \+3\.06 个百分点/);
  assert.match(c.paragraph, /短窗|窗口|卖出|估值/);
  assert.ok(c.paragraph.length > 40);
  assertNoBannedTone(c.paragraph);
});

test('formatBuyHoldCompare recomputes edge from return − benchmark', () => {
  const c = formatBuyHoldCompare({
    returnPpm: 10000,
    benchmarkReturnPpm: -20000,
  });
  assert.equal(c.edgePp, '+3.00');
  assert.match(c.paragraph, /多出 \+3\.00/);
});

test('formatBuyHoldCompare negative edge wording', () => {
  const c = formatBuyHoldCompare({
    returnPpm: -50000,
    benchmarkReturnPpm: -20000,
    edgePpm: -30000,
  });
  assert.match(c.paragraph, /落后 -3\.00 个百分点/);
  assertNoBannedTone(c.paragraph);
});

test('formatBuyHoldCompare null when numbers missing', () => {
  assert.equal(formatBuyHoldCompare({}), null);
  assert.equal(formatBuyHoldCompare({ returnPpm: 1 }), null);
});

test('formatStarBreakdown 3★ with mdd/orders facts', () => {
  const s = formatStarBreakdown({
    stars: 3,
    twoStarMet: true,
    threeStarMet: true,
    edgePpm: 82000,
    mddPpm: 180000,
    tradeCount: 1,
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 30, maxOrders: 1 },
    },
  });
  assert.equal(s.starN, 3);
  assert.ok(s.items.every((it) => it.met === true));
  assert.ok(s.items.some((it) => it.label.includes('合法完成')));
  assert.ok(s.items.some((it) => it.label.includes('收益比买持') && it.label.includes('+8.20') && !it.label.includes('二星：')));
  assert.ok(s.items.some((it) => it.label.includes('回撤 18.00%') && !it.label.startsWith('三星')));
  assert.ok(s.lines.some((l) => l.startsWith('✓') && l.includes('合法完成')));
  assert.ok(s.lines.some((l) => l.startsWith('✓') && l.includes('+8.20')));
  assert.ok(s.lines.some((l) => l.startsWith('✓') && l.includes('回撤 18.00%')));
  assert.ok(!s.lines.some((l) => /1★|2★|3★/.test(l)));
  assert.match(s.paragraph, /3 星/);
  assert.match(s.paragraph, /\+8\.20pp|18\.00%/);
  assertNoBannedTone(s.paragraph);
  s.lines.forEach(assertNoBannedTone);
});

test('formatStarBreakdown 1★ marks 2★/3★ missed with edge', () => {
  const s = formatStarBreakdown({
    stars: 1,
    twoStarMet: false,
    threeStarMet: false,
    edgePpm: -15000,
    mddPpm: 400000,
    tradeCount: 2,
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 30, maxOrders: 1 },
    },
  });
  assert.equal(s.starN, 1);
  assert.equal(s.items[0].met, true);
  assert.equal(s.items[1].met, false);
  assert.equal(s.items[2].met, false);
  assert.ok(s.lines.some((l) => l.startsWith('○') && l.includes('未达线') && l.includes('收益比买持')));
  assert.ok(s.lines.some((l) => l.startsWith('○') && (l.includes('回撤') || l.includes('成交'))));
  assert.ok(!s.lines.some((l) => /1★|2★|3★/.test(l)));
  assert.match(s.paragraph, /1 星/);
  assert.match(s.paragraph, /-1\.50pp/);
  assertNoBannedTone(s.paragraph);
});

test('formatStarBreakdown 2★ not 3★', () => {
  const s = formatStarBreakdown({
    stars: 2,
    twoStarMet: true,
    threeStarMet: false,
    edgePpm: 50000,
    mddPpm: 350000,
    tradeCount: 2,
    goals: {
      twoStar: { beatBuyHoldPp: 3 },
      threeStar: { maxMddPct: 30, maxOrders: 1 },
    },
  });
  assert.equal(s.items[1].met, true);
  assert.equal(s.items[2].met, false);
  assert.ok(s.lines.some((l) => l.startsWith('✓') && l.includes('收益比买持')));
  assert.ok(s.lines.some((l) => l.startsWith('○') && (l.includes('回撤') || l.includes('成交'))));
  assert.match(s.paragraph, /2 星/);
  assert.match(s.paragraph, /三星侧/);
  assertNoBannedTone(s.paragraph);
});

test('describeOpenSituation T+1 locked full position', () => {
  const d = describeOpenSituation({
    initialState: {
      cash: 0,
      qty: 100,
      cost: 12.5,
      firstSellableDay: 2,
    },
    maxOrders: 1,
    theme: '刚买入的锁定持仓',
    openStateHint: '开局满仓且 T+1 锁定，首日不可卖',
  });
  assert.equal(d.theme, '刚买入的锁定持仓');
  assert.ok(d.parts.some((p) => /T\+1/.test(p)));
  assert.ok(d.parts.some((p) => /订单上限 1/.test(p)));
});

test('describeOpenSituation flat start', () => {
  const d = describeOpenSituation({
    initialState: { cash: 100000, qty: 0, firstSellableDay: 1 },
    maxOrders: 2,
  });
  assert.ok(d.parts.some((p) => /空仓/.test(p)));
  assert.ok(d.parts.some((p) => /订单上限 2/.test(p)));
});

test('describeTradePath empty vs sells', () => {
  assert.match(describeTradePath([], { gameDays: 6 }), /没有成交/);
  const path = describeTradePath(
    [{ type: 'sell', day: 2, price: 32.14 }],
    { gameDays: 6 }
  );
  assert.match(path, /第 2 日卖出/);
  assert.match(path, /32\.14/);
  assert.match(path, /第 6 日/);
  assertNoBannedTone(path);
});

test('formatSituationNarrative ch1-01 style underwater sell', () => {
  const paras = formatSituationNarrative({
    theme: '买入后已有浮亏',
    teachingBrief: '开局已浮亏。继续死扛还是止损离场，比的是相对买入持有少亏多少。',
    openStateHint: '开局已满仓浮亏，可卖可持',
    initialState: {
      cash: 0,
      qty: 2520,
      cost: 39.68,
      buyFillDay: 0,
      firstSellableDay: 1,
    },
    maxOrders: 1,
    gameDays: 6,
    tradeHistory: [{ type: 'sell', day: 2, price: 32.14 }],
    puzzleResult: {
      stars: 3,
      twoStarMet: true,
      threeStarMet: true,
      returnPpm: -321400,
      benchmarkReturnPpm: -352000,
      edgePpm: 30600,
      mddPpm: 180000,
      tradeCount: 1,
      goals: {
        twoStar: { beatBuyHoldPp: 3 },
        threeStar: { maxMddPct: 30, maxOrders: 1 },
      },
    },
  });
  assert.equal(paras.length, 2);
  assert.match(paras[0], /买入后已有浮亏/);
  assert.match(paras[0], /满仓/);
  assert.match(paras[0], /卖出/);
  assert.match(paras[1], /\+3\.06pp|-32\.14%|3 星/);
  paras.forEach((p) => {
    assert.ok(p.length > 30, 'paragraph should be measured, not a slogan');
    assertNoBannedTone(p);
  });
  // No one-line verdict stacks
  assert.ok(!paras.some((p) => /应止损|完美操作/.test(p)));
});

test('formatPuzzleDebrief pending / fail / ok', () => {
  const pending = formatPuzzleDebrief({ status: 'pending' });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.sectionTitle, '复盘');
  assert.equal(pending.buyHoldCompare, null);
  assert.equal(pending.bsNote, PUZZLE_BS_NOTE);
  assert.match(pending.situationParagraphs[0], /结算保存完成/);

  const fail = formatPuzzleDebrief({ status: 'fail', saveError: '网络超时' });
  assert.equal(fail.status, 'fail');
  assert.match(fail.situationParagraphs[0], /网络超时/);
  assert.match(fail.situationParagraphs[0], /K 线/);

  const ok = formatPuzzleDebrief({
    status: 'ok',
    theme: '买入后已有浮亏',
    openStateHint: '开局已满仓浮亏，可卖可持',
    teachingBrief: '开局已浮亏。',
    initialState: { cash: 0, qty: 100, cost: 10, firstSellableDay: 1 },
    maxOrders: 1,
    gameDays: 6,
    tradeHistory: [{ type: 'sell', day: 1, price: 9.5 }],
    puzzleResult: {
      stars: 2,
      twoStarMet: true,
      threeStarMet: false,
      returnPpm: 40000,
      benchmarkReturnPpm: 0,
      edgePpm: 40000,
      mddPpm: 50000,
      tradeCount: 1,
      goals: {
        twoStar: { beatBuyHoldPp: 3 },
        threeStar: { maxMddPct: 30, maxOrders: 1 },
      },
    },
  });
  assert.equal(ok.status, 'ok');
  assert.ok(ok.buyHoldCompare);
  assert.equal(ok.buyHoldCompare.edgePp, '+4.00');
  assert.ok(ok.starBreakdown);
  assert.equal(ok.starBreakdown.starN, 2);
  assert.ok(ok.situationParagraphs.length >= 1);
  assert.equal(ok.bsNote, PUZZLE_BS_NOTE);
  assert.match(ok.bsNote, /不套用经典 BS/);
  const blob = [
    ok.buyHoldCompare.paragraph,
    ...ok.starBreakdown.lines,
    ok.starBreakdown.paragraph,
    ...ok.situationParagraphs,
    ok.bsNote,
  ].join('\n');
  assertNoBannedTone(blob);
});

test('PUZZLE_BS_NOTE is short and non-slogan', () => {
  assert.match(PUZZLE_BS_NOTE, /短窗残局/);
  assert.match(PUZZLE_BS_NOTE, /BS/);
  assertNoBannedTone(PUZZLE_BS_NOTE);
});
