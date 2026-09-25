import test from 'node:test';
import assert from 'node:assert/strict';
import { roundHalfUp } from '../../shared/engine.js';
import { INTRADAY_BAR_COUNT as TAPE_BARS, limitBandFen } from '../../shared/intradayTape.js';
import {
  GAME_KIND_INTRADAY,
  GAME_KIND_SET,
  GAME_KINDS,
  SCORE_VERSION_INTRADAY_V1 as PROTOCOL_SCORE,
} from '../../shared/protocol.js';
import {
  COMMISSION_PPM,
  INTRADAY_ACT_SLACK_MS,
  INTRADAY_BAR_COUNT,
  INTRADAY_RANKED_BAR_MS,
  NAV_SCALE,
  SCORE_VERSION_INTRADAY_V1,
  STAMP_PPM,
  actDeadlineMs,
  playbackClock,
  replayIntraday,
} from '../../shared/intradayEngine.js';
import * as intradayEngine from '../../shared/intradayEngine.js';

const SELL_FACTOR = 1_000_000 - COMMISSION_PPM - STAMP_PPM;
const BUY_FACTOR = 1_000_000 - COMMISSION_PPM;

function barsOf(closeFen, overrides) {
  const bars = [];
  for (let i = 0; i < INTRADAY_BAR_COUNT; i += 1) {
    const price = overrides && overrides[i] != null ? overrides[i] : closeFen;
    bars.push({ closeFen: price });
  }
  return bars;
}

function replay(overrides) {
  return replayIntraday({
    startMode: 'flat',
    bars: barsOf(10000),
    actions: [],
    prevCloseFen: 10000,
    limitPct: 10,
    ...overrides,
  });
}

test('score version stays off the 30-day kind list', () => {
  assert.equal(GAME_KIND_INTRADAY, 'intraday');
  assert.equal(SCORE_VERSION_INTRADAY_V1, 'intraday-t0-mtm-v1');
  assert.equal(PROTOCOL_SCORE, SCORE_VERSION_INTRADAY_V1);
  assert.equal(GAME_KINDS.includes('intraday'), false);
  assert.equal(GAME_KIND_SET.has('intraday'), false);
  assert.equal(INTRADAY_BAR_COUNT, 241);
  assert.equal(INTRADAY_BAR_COUNT, TAPE_BARS);
  assert.equal(SELL_FACTOR, 999250);
  assert.equal(BUY_FACTOR, 999750);
});

test('flat with no actions settles at zero', () => {
  const r = replay({
    bars: barsOf(148800),
    actions: [],
    finish: true,
    prevCloseFen: undefined,
    limitPct: undefined,
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.returnPpm, 0);
  assert.equal(r.endNav, NAV_SCALE);
  assert.equal(r.markReturnPpm, 0);
  assert.equal(r.tradeCount, 0);
  assert.equal(r.liquidation, 0);
  assert.equal(r.endPosition, 'empty');
  assert.equal(r.feeDragPpm, 0);
  assert.equal(r.scoreVersion, 'intraday-t0-mtm-v1');
});

test('long with no actions liquidates bar 0 against the last close', () => {
  const openFen = 10000;
  const closeFen = 12000;
  const bars = barsOf(openFen, { 240: closeFen });
  const on = replay({
    startMode: 'long',
    bars,
    actions: [],
    finish: true,
    prevCloseFen: undefined,
    limitPct: undefined,
  });
  const off = replay({
    startMode: 'long',
    bars,
    actions: [],
    finish: true,
    fees: false,
    prevCloseFen: undefined,
    limitPct: undefined,
  });
  const gross = roundHalfUp(NAV_SCALE * closeFen / openFen);
  const endNav = roundHalfUp(gross * SELL_FACTOR / 1_000_000);
  assert.equal(on.ok, true, on.message);
  assert.equal(on.endNav, endNav);
  assert.equal(on.endNav, 1_199_100_000);
  assert.equal(on.returnPpm, roundHalfUp((on.endNav - NAV_SCALE) / 1000));
  assert.equal(on.returnPpm, 199100);
  assert.notEqual(on.returnPpm, roundHalfUp((0.2 - 0.00075) * 1e6));
  assert.equal(on.tradeCount, 0);
  assert.equal(on.liquidation, 1);
  assert.equal(on.endPosition, 'empty');
  assert.equal(on.markReturnPpm, 0);
  assert.equal(off.returnPpm, 200000);
  assert.equal(off.returnPpm - on.returnPpm, on.feeDragPpm);
  assert.equal(on.feeDragPpm, 900);
  assert.equal(off.feeDragPpm, 900);
});

test('buy uses commission only and a round trip counts two trades', () => {
  const bars = barsOf(10000);
  const actions = [
    { barIndex: 0, side: 'buy' },
    { barIndex: 3, side: 'sell' },
  ];
  const held = replay({
    bars,
    actions: [{ barIndex: 0, side: 'buy' }],
    finish: false,
  });
  const cashAfter = roundHalfUp(NAV_SCALE * BUY_FACTOR / 1_000_000);
  assert.equal(held.ok, true, held.message);
  assert.equal(held.sharesNum, cashAfter);
  assert.equal(held.sharesNum, 999_750_000);
  assert.equal(held.sharesDen, 10000);
  assert.equal(held.position, 'long');
  assert.equal(held.tradeCount, 1);
  assert.equal(held.liquidation, 0);

  const on = replay({ bars, actions, finish: true });
  const off = replay({ bars, actions, finish: true, fees: false });
  const gross = roundHalfUp(cashAfter * 10000 / 10000);
  const endNav = roundHalfUp(gross * SELL_FACTOR / 1_000_000);
  assert.equal(on.ok, true, on.message);
  assert.equal(on.endNav, endNav);
  assert.equal(on.endNav, 999_000_188);
  assert.equal(on.returnPpm, -1000);
  assert.equal(on.tradeCount, 2);
  assert.equal(on.liquidation, 0);
  assert.equal(on.endPosition, 'empty');
  assert.equal(on.trades.map((t) => t.side).join(','), 'buy,sell');
  assert.equal(off.returnPpm, 0);
  assert.equal(off.returnPpm - on.returnPpm, on.feeDragPpm);
});

test('closeFen above 32767 is the fill and stays a safe product', () => {
  const bars = barsOf(148800, { 1: 148801 });
  const r = replay({
    bars,
    actions: [
      { barIndex: 0, side: 'buy' },
      { barIndex: 1, side: 'sell' },
    ],
    finish: true,
    prevCloseFen: 140000,
    limitPct: 10,
  });
  const cashAfter = roundHalfUp(NAV_SCALE * BUY_FACTOR / 1_000_000);
  const gross = roundHalfUp(cashAfter * 148801 / 148800);
  const endNav = roundHalfUp(gross * SELL_FACTOR / 1_000_000);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.trades[0].closeFen, 148800);
  assert.equal(r.trades[1].closeFen, 148801);
  assert.ok(r.trades[0].closeFen > 32767);
  assert.equal(r.endNav, endNav);
  assert.equal(r.tradeCount, 2);
  assert.equal(Number.isSafeInteger(NAV_SCALE * 148800), true);
  assert.ok(NAV_SCALE * 148800 < Number.MAX_SAFE_INTEGER);
});

test('a second order on the same bar is rejected', () => {
  const r = replay({
    actions: [
      { barIndex: 2, side: 'buy' },
      { barIndex: 2, side: 'sell' },
    ],
    finish: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAR_ALREADY_ACTED');
});

test('selling backward is closed and selling flat is empty', () => {
  const back = replay({
    actions: [
      { barIndex: 3, side: 'buy' },
      { barIndex: 1, side: 'sell' },
    ],
  });
  assert.equal(back.code, 'BAR_CLOSED');
  const empty = replay({
    actions: [{ barIndex: 0, side: 'sell' }],
  });
  assert.equal(empty.code, 'SELL_WHILE_EMPTY');
  const doubled = replay({
    startMode: 'long',
    actions: [{ barIndex: 1, side: 'buy' }],
  });
  assert.equal(doubled.code, 'BUY_WHILE_LONG');
});

test('player limits use the tape band and do not block liquidation', () => {
  const prev = 10001;
  const band = limitBandFen(prev, 10);
  assert.equal(band.limitDownFen, roundHalfUp(prev * 90 / 100));
  assert.equal(band.limitUpFen, roundHalfUp(prev * 110 / 100));

  const sellDown = replay({
    startMode: 'long',
    bars: barsOf(prev, { 4: band.limitDownFen }),
    actions: [{ barIndex: 4, side: 'sell' }],
    finish: true,
    prevCloseFen: prev,
    limitPct: 10,
  });
  assert.equal(sellDown.ok, false);
  assert.equal(sellDown.code, 'LIMIT_DOWN');

  const sellAbove = replay({
    startMode: 'long',
    bars: barsOf(prev, { 4: band.limitDownFen + 1 }),
    actions: [{ barIndex: 4, side: 'sell' }],
    finish: true,
    prevCloseFen: prev,
    limitPct: 10,
  });
  assert.equal(sellAbove.ok, true, sellAbove.message);
  assert.equal(sellAbove.tradeCount, 1);
  assert.equal(sellAbove.liquidation, 0);

  const buyUp = replay({
    bars: barsOf(prev, { 2: band.limitUpFen }),
    actions: [{ barIndex: 2, side: 'buy' }],
    prevCloseFen: prev,
    limitPct: 10,
  });
  assert.equal(buyUp.code, 'LIMIT_UP');

  const buyUnder = replay({
    bars: barsOf(prev, { 2: band.limitUpFen - 1 }),
    actions: [{ barIndex: 2, side: 'buy' }],
    prevCloseFen: prev,
    limitPct: 10,
  });
  assert.equal(buyUnder.ok, true, buyUnder.message);

  const explicit = replayIntraday({
    startMode: 'long',
    bars: barsOf(10000, { 4: 9000 }),
    actions: [{ barIndex: 4, side: 'sell' }],
    limitUpFen: 11000,
    limitDownFen: 9000,
  });
  assert.equal(explicit.code, 'LIMIT_DOWN');

  const downClose = replay({
    startMode: 'long',
    bars: barsOf(10000, { 240: 9000 }),
    actions: [],
    finish: true,
    prevCloseFen: 10000,
    limitPct: 10,
  });
  assert.equal(downClose.ok, true, downClose.message);
  assert.equal(downClose.endPosition, 'empty');
  assert.equal(downClose.liquidation, 1);
  assert.equal(downClose.tradeCount, 0);
  assert.equal(downClose.code, undefined);

  const upClose = replay({
    startMode: 'long',
    bars: barsOf(10000, { 240: 11000 }),
    actions: [],
    finish: true,
    prevCloseFen: 10000,
    limitPct: 10,
  });
  assert.equal(upClose.ok, true, upClose.message);
  assert.equal(upClose.endPosition, 'empty');
  assert.equal(upClose.liquidation, 1);
  assert.equal(upClose.tradeCount, 0);
});

test('playback clock keeps the last bar through the 400ms slack', () => {
  assert.equal(INTRADAY_RANKED_BAR_MS, 100);
  assert.equal(INTRADAY_ACT_SLACK_MS, 400);
  for (const key of Object.keys(intradayEngine)) {
    assert.equal(/speed|2x|4x/i.test(key), false, key);
  }

  const early = playbackClock({
    originMs: 1000,
    nowMs: 999,
    intervalMs: INTRADAY_RANKED_BAR_MS,
    barCount: INTRADAY_BAR_COUNT,
  });
  assert.equal(early.raw, -1);
  assert.equal(early.released, -1);
  assert.equal(early.tapeClosed, false);
  assert.equal(early.settleReady, false);

  const lastOpen = playbackClock({
    originMs: 0,
    nowMs: 240 * 100,
    intervalMs: 100,
    barCount: 241,
  });
  assert.equal(lastOpen.tapeClosed, false);
  assert.equal(lastOpen.released, 240);
  assert.equal(lastOpen.settleReady, false);
  const buyLast = replay({
    actions: [{ barIndex: 240, side: 'buy' }],
    originMs: 0,
    nowMs: 240 * 100,
    finish: false,
    speed: 2,
  });
  assert.equal(buyLast.ok, true, buyLast.message);

  const closed = playbackClock({
    originMs: 0,
    nowMs: 241 * 100,
    intervalMs: 100,
    barCount: 241,
  });
  assert.equal(closed.raw, 241);
  assert.equal(closed.released, 240);
  assert.equal(closed.tapeClosed, true);
  assert.equal(closed.settleReady, false);
  const stillLast = replay({
    actions: [{ barIndex: 240, side: 'buy' }],
    originMs: 0,
    nowMs: 241 * 100,
    finish: false,
    speed: 4,
  });
  assert.equal(stillLast.ok, true, stillLast.message);

  const ready = playbackClock({
    originMs: 0,
    nowMs: 241 * 100 + 400,
    intervalMs: 100,
    barCount: 241,
  });
  assert.equal(ready.tapeClosed, true);
  assert.equal(ready.settleReady, true);
  assert.equal(actDeadlineMs(0, 240), 241 * 100 + 400);
  const lateLast = replay({
    actions: [{ barIndex: 240, side: 'buy' }],
    originMs: 0,
    nowMs: 241 * 100 + 400,
    finish: false,
  });
  assert.equal(lateLast.code, 'BAR_CLOSED');

  assert.equal(actDeadlineMs(0, 0), 100 + 400);
  const bar0Open = replay({
    actions: [{ barIndex: 0, side: 'buy' }],
    originMs: 0,
    nowMs: 100 + 400 - 1,
    finish: false,
    speed: 2,
  });
  assert.equal(bar0Open.ok, true, bar0Open.message);
  const bar0Shut = replay({
    actions: [{ barIndex: 0, side: 'buy' }],
    originMs: 0,
    nowMs: 100 + 400,
    finish: false,
  });
  assert.equal(bar0Shut.ok, false);
  assert.equal(bar0Shut.code, 'BAR_CLOSED');

  const future = replay({
    actions: [{ barIndex: 1, side: 'buy' }],
    originMs: 0,
    nowMs: 0,
  });
  assert.equal(future.code, 'FUTURE_BAR');

  const roundTrip = replay({
    actions: [
      { barIndex: 0, side: 'buy' },
      { barIndex: 2, side: 'sell' },
    ],
    originMs: 0,
    nowMs: 2 * 100 + 400 - 1,
    finish: false,
  });
  assert.equal(roundTrip.ok, true, roundTrip.message);
  assert.equal(roundTrip.tradeCount, 2);

  const pausedClock = playbackClock({
    originMs: 0,
    nowMs: 5000,
    intervalMs: 100,
    barCount: 241,
    pausedAtMs: 1000,
  });
  assert.equal(pausedClock.raw, 10);
  const pausedAct = replay({
    actions: [{ barIndex: 0, side: 'buy' }],
    originMs: 0,
    nowMs: 10_000,
    pausedAtMs: 100 + 400 - 1,
    finish: false,
  });
  assert.equal(pausedAct.ok, true, pausedAct.message);
});

test('rejects typed arrays and compact tuples', () => {
  const typed = replayIntraday({
    startMode: 'flat',
    bars: new Int16Array(INTRADAY_BAR_COUNT),
    actions: [],
    finish: true,
  });
  assert.equal(typed.ok, false);
  assert.equal(typed.code, 'BAD_TAPE');
  const tuples = replay({
    bars: Array.from({ length: INTRADAY_BAR_COUNT }, () => [10000, 1, 10000, 10000]),
    prevCloseFen: undefined,
    limitPct: undefined,
  });
  assert.equal(tuples.code, 'BAD_TAPE');
});
