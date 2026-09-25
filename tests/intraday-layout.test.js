import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  describeFlatRankedCard,
  describeLongRankedCard,
  renderIntradayBoardPane,
  shouldRefetchFlatRankedStatus,
  shouldRefetchLongRankedStatus,
} from '../js/home-ia.js';
import {
  OPENING_LONG_MARK_COPY,
  RANKED_FLAT_CONFIRM_TEXT,
  RANKED_FLAT_TAPE_MS,
  RANKED_LONG_CONFIRM_TEXT,
  RANKED_LONG_TAPE_MS,
  hudReturnLabel,
  openingConfirmText,
  practiceOpeningChoice,
  rankedFlatGate,
  rankedLongGate,
  sessionOriginPlan,
} from '../js/intraday.js';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

test('intraday lane is the last element child of #playModes and hides without a slot', () => {
  const html = read('index.html');
  const start = html.indexOf('id="playModes"');
  const end = html.indexOf('id="puzzleChapters"');
  assert.ok(start > 0 && end > start);
  const block = html.slice(start, end);
  const buttons = [...block.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  const last = buttons[buttons.length - 1];
  assert.match(last, /class="lane intraday-mode-lane"/);
  assert.match(last, /id="intradayLongModeCard"/);
  assert.match(last, /\shidden\b/);
  const flatAt = block.indexOf('id="intradayModeCard"');
  const longAt = block.indexOf('id="intradayLongModeCard"');
  assert.ok(block.indexOf('id="survivalModeCard"') < flatAt);
  assert.ok(block.indexOf('id="dailyChallengeCard"') < flatAt);
  assert.ok(flatAt < longAt);
  assert.match(block.slice(flatAt, longAt), /class="lane intraday-mode-lane"/);
  assert.match(block.slice(flatAt, flatAt + 180), /\shidden\b/);
  const tail = block.slice(block.lastIndexOf('</button>') + '</button>'.length);
  assert.match(tail, /^\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div\s/);
  assert.equal(block.includes('startMode'), false);

  const css = read('css/intraday.css');
  assert.match(
    css,
    /\.start-screen \.intraday-mode-lane\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
  );
  assert.match(css, /\.start-screen \.intraday-mode-lane\s*\{/);
  assert.equal(css.includes('.lane'), false);
  assert.equal(css.includes('#gameScreen'), false);
  assert.equal(css.includes('#homeLanes'), false);
  assert.equal(css.includes('#dailyChallengeCard'), false);
  assert.equal(css.includes('#oneshotModeCard'), false);
  assert.equal(css.includes('#survivalModeCard'), false);

  const modalAt = html.indexOf('id="intradayBoardModal"');
  const dailyAt = html.indexOf('id="dailyChallengeBoardModal"');
  assert.ok(modalAt > dailyAt);
  assert.match(html, /id="intradayBoardModal"[\s\S]*id="intradayBoardTitle"/);
  assert.equal(html.includes('intraday.js'), false);
});

test('flat ranked confirm is the public 21:00 phase', () => {
  const text = RANKED_FLAT_CONFIRM_TEXT;
  assert.match(text, /30 韭币/);
  assert.match(text, /每天一次/);
  assert.match(text, /模拟 T\+0/);
  assert.match(text, /24\.1 秒/);
  assert.match(text, /没有名次奖励/);
  assert.match(text, /21:00（Asia\/Shanghai）/);
  assert.match(text, /提前 60 秒入场并预加载空图表/);
  assert.match(text, /迟到未交付的分钟不能补/);
  assert.match(text, /今天不能再开空仓正式局/);
  assert.equal(text.includes(OPENING_LONG_MARK_COPY), false);
  assert.equal(RANKED_FLAT_TAPE_MS, 24100);
  assert.equal(openingConfirmText('flat'), text);

  const player = read('js/intraday.js');
  assert.match(player, /body:\s*\{\s*mode,\s*startMode\s*\}/);
  assert.match(player, /startRanked\('flat'\)/);
  const home = read('js/home-ia.js');
  assert.match(home, /refreshIntradayModeCard\(\)/);
  assert.match(home, /fetchIntradayBoard\("flat"\)/);
  assert.match(home, /leaderboard\?startMode=/);
  assert.equal(/from\s+['"]\.\/intraday\.js['"]/.test(home), false);
});

test('hub card follows ready and the flat phase countdown', () => {
  const phase = Date.parse('2026-09-25T13:00:00.000Z');
  const status = {
    ready: true,
    message: '',
    phaseStartsAt: {
      flat: '2026-09-25T13:00:00.000Z',
      long: '2026-09-25T13:05:00.000Z',
    },
    cost: { ranked: 30, practice: 10 },
    remainingChance: { flat: 1, long: 1 },
    activeSession: null,
    serverNowMs: phase,
  };
  const preparing = describeFlatRankedCard(
    { ready: false, message: '分时题库准备中', phaseStartsAt: null },
    phase,
  );
  assert.equal(preparing.disabled, true);
  assert.equal(preparing.state, '分时题库准备中');

  const early = describeFlatRankedCard(status, phase - 120_000);
  assert.equal(early.disabled, true);
  assert.match(early.state, /距离 21:00 还有/);

  const lead = describeFlatRankedCard(status, phase - 30_000);
  assert.equal(lead.disabled, false);
  assert.equal(lead.cta, '提前进入');
  assert.match(lead.state, /预加载空图表/);

  const live = describeFlatRankedCard(status, phase + 1_000);
  assert.equal(live.disabled, false);
  assert.match(live.state, /迟到的分钟不能补/);

  const closed = describeFlatRankedCard(status, phase + RANKED_FLAT_TAPE_MS);
  assert.equal(closed.disabled, true);
  assert.match(closed.state, /今日空仓正式局已结束/);
  assert.match(closed.state, /距离下一场 21:00/);

  assert.equal(rankedFlatGate(status, phase - 60_000).ok, true);
  assert.equal(rankedFlatGate(status, phase - 60_001).ok, false);
  assert.equal(rankedFlatGate(status, phase + RANKED_FLAT_TAPE_MS - 1).ok, true);
  assert.equal(rankedFlatGate(status, phase + RANKED_FLAT_TAPE_MS).ok, false);
  assert.equal(rankedFlatGate({ ...status, remainingChance: { flat: 0, long: 1 } }, phase).ok, false);
  assert.match(describeFlatRankedCard(status, phase).meta, /没有名次奖励/);
  assert.match(describeFlatRankedCard(status, phase).meta, /模拟 T\+0/);
});

test('closed flat card refetches when the next join lead opens', () => {
  const phase = Date.parse('2026-09-25T13:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const nextLead = phase + day - 60_000;
  const status = {
    ready: true,
    phaseStartsAt: { flat: '2026-09-25T13:00:00.000Z', long: '2026-09-25T13:05:00.000Z' },
    remainingChance: { flat: 0, long: 1 },
    activeSession: null,
  };
  const closed = describeFlatRankedCard(status, phase + 24_100);
  assert.equal(closed.disabled, true);
  assert.equal(shouldRefetchFlatRankedStatus(status, phase + 24_100), false);
  assert.equal(shouldRefetchFlatRankedStatus(status, nextLead - 1), false);
  assert.equal(shouldRefetchFlatRankedStatus(status, nextLead), true);
  assert.equal(shouldRefetchFlatRankedStatus({ ready: false, phaseStartsAt: null }, nextLead), false);

  const nextPhase = phase + day;
  const refreshed = {
    ...status,
    phaseStartsAt: {
      flat: new Date(nextPhase).toISOString(),
      long: new Date(nextPhase + 5 * 60 * 1000).toISOString(),
    },
    remainingChance: { flat: 1, long: 1 },
  };
  assert.equal(shouldRefetchFlatRankedStatus(refreshed, nextLead), false);
  const open = describeFlatRankedCard(refreshed, nextLead);
  assert.equal(open.disabled, false);
  assert.equal(open.cta, '提前进入');

  const home = read('js/home-ia.js');
  const timer = home.slice(home.indexOf('function startIntradayCardTimer'), home.indexOf('async function fetchIntradayStatus'));
  assert.match(timer, /shouldRefetchFlatRankedStatus/);
  assert.match(timer, /shouldRefetchLongRankedStatus/);
  assert.match(timer, /refetchIntradayHubStatus/);
  assert.match(home, /fetch\("\/api\/v1\/intraday"/);
});

test('opening-long copy, 21:05 gate, and separate board', () => {
  const text = RANKED_LONG_CONFIRM_TEXT;
  assert.equal(text.includes(OPENING_LONG_MARK_COPY), true);
  assert.match(text, /起点按开盘价记 0/);
  assert.match(text, /收盘价乘卖出费率结算/);
  assert.match(text, /不是开盘到收盘再减一个固定 bps/);
  assert.match(text, /21:05（Asia\/Shanghai）/);
  assert.match(text, /24\.1 秒/);
  assert.match(text, /每根 100ms/);
  assert.match(text, /迟到未交付的分钟不能补/);
  assert.match(text, /今天不能再开已持有正式局/);
  assert.match(text, /30 韭币/);
  assert.match(text, /没有名次奖励/);
  assert.equal(RANKED_LONG_TAPE_MS, 24100);
  assert.equal(openingConfirmText('long'), text);
  assert.equal(practiceOpeningChoice('long').startMode, 'long');
  assert.equal(practiceOpeningChoice('long').detail.includes(OPENING_LONG_MARK_COPY), true);
  assert.equal(practiceOpeningChoice('flat').startMode, 'flat');
  assert.equal(practiceOpeningChoice('flat').detail.includes('固定 bps'), false);

  const html = read('index.html');
  assert.equal(html.includes(RANKED_LONG_CONFIRM_TEXT), true);
  assert.equal(html.includes(practiceOpeningChoice('long').detail), true);
  assert.ok(html.indexOf('id="intradayBoardFlatPane"') < html.indexOf('id="intradayBoardLongPane"'));

  const phase = Date.parse('2026-09-25T13:00:00.000Z');
  const longPhase = Date.parse('2026-09-25T13:05:00.000Z');
  const status = {
    ready: true,
    phaseStartsAt: {
      flat: '2026-09-25T13:00:00.000Z',
      long: '2026-09-25T13:05:00.000Z',
    },
    remainingChance: { flat: 1, long: 1 },
    activeSession: null,
    serverNowMs: longPhase,
  };
  assert.equal(rankedLongGate(status, phase).ok, false);
  assert.equal(rankedFlatGate(status, phase).ok, true);
  assert.equal(rankedLongGate(status, longPhase - 60_000).ok, true);
  assert.equal(rankedLongGate(status, longPhase - 60_001).ok, false);
  assert.equal(rankedLongGate(status, longPhase + RANKED_LONG_TAPE_MS - 1).ok, true);
  assert.equal(rankedLongGate(status, longPhase + RANKED_LONG_TAPE_MS).ok, false);
  assert.equal(rankedLongGate({ ...status, remainingChance: { flat: 1, long: 0 } }, longPhase).ok, false);
  assert.match(rankedLongGate(status, longPhase + RANKED_LONG_TAPE_MS).message, /今日已持有正式局已结束/);

  const duringFlat = describeLongRankedCard(status, phase + 1_000);
  assert.equal(duringFlat.disabled, true);
  assert.match(duringFlat.state, /距离 21:05 还有/);
  const live = describeLongRankedCard(status, longPhase + 1_000);
  assert.equal(live.disabled, false);
  assert.match(live.state, /迟到的分钟不能补/);
  assert.match(live.meta, /21:05/);
  assert.match(live.meta, /100ms/);
  const closed = describeLongRankedCard(status, longPhase + RANKED_LONG_TAPE_MS);
  assert.equal(closed.disabled, true);
  assert.match(closed.state, /今日已持有正式局已结束/);
  const used = describeLongRankedCard({ ...status, remainingChance: { flat: 1, long: 0 } }, longPhase);
  assert.match(used.state, /今日已持有机会已用完/);
  assert.match(describeFlatRankedCard(status, phase).state, /迟到的分钟不能补/);

  const day = 24 * 60 * 60 * 1000;
  const nextLongLead = longPhase + day - 60_000;
  assert.equal(shouldRefetchLongRankedStatus(status, longPhase + RANKED_LONG_TAPE_MS), false);
  assert.equal(shouldRefetchLongRankedStatus(status, nextLongLead), true);

  const flatBoard = renderIntradayBoardPane({
    ready: true,
    date: '2026-09-25',
    total: 1,
    entries: [{ rank: 1, nickname: '空仓甲', returnPct: '1.20', tradeCount: 2 }],
  }, '分时空仓榜');
  const longBoard = renderIntradayBoardPane({
    ready: true,
    date: '2026-09-25',
    total: 1,
    entries: [{ rank: 1, nickname: '持仓乙', returnPct: '3.40', tradeCount: 1 }],
  }, '分时已持有榜');
  assert.match(flatBoard, /空仓甲/);
  assert.equal(flatBoard.includes('持仓乙'), false);
  assert.match(longBoard, /持仓乙/);
  assert.equal(longBoard.includes('空仓甲'), false);

  const home = read('js/home-ia.js');
  assert.match(home, /fetchIntradayBoard\("long"\)/);
  assert.match(home, /startIntradayRankedLong/);
  const player = read('js/intraday.js');
  assert.match(player, /startRanked\('long'\)/);
  assert.match(player, /openSession\('practice', chosen\)/);

  const rankedLong = sessionOriginPlan({
    mode: 'ranked',
    phaseStartsAt: '2026-09-25T13:05:00.000Z',
    serverNowMs: 1,
  });
  assert.equal(rankedLong.privateClock, false);
  assert.equal(rankedLong.originKnown, true);
  assert.equal(rankedLong.originMs, longPhase);
  const rankedMissing = sessionOriginPlan({
    mode: 'ranked',
    startMode: 'long',
    phaseStartsAt: null,
    serverNowMs: 12345,
  });
  assert.equal(rankedMissing.privateClock, false);
  assert.equal(rankedMissing.originKnown, false);
  assert.equal(rankedMissing.originMs, null);
  const practiceLong = sessionOriginPlan({
    mode: 'practice',
    phaseStartsAt: null,
    serverNowMs: 12345,
  });
  assert.equal(practiceLong.privateClock, true);
  assert.equal(practiceLong.originMs, 12345);

  assert.equal(hudReturnLabel({ settled: false, markReturnPpm: 0 }), '盯市 0.00%');
  assert.equal(hudReturnLabel({ settled: true, returnPpm: 15000 }), '结算（含收盘卖出费用） +1.50%');
  assert.equal(hudReturnLabel({ settled: false, markReturnPpm: 15000 }).startsWith('盯市 '), true);
  assert.equal(hudReturnLabel({ settled: true, returnPpm: 0 }).includes('盯市'), false);
});
