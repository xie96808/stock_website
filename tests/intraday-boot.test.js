import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Route, resolveHashRoute } from '../js/screen-router.js';
import {
  INTRADAY_BOOT_STAGES,
  INTRADAY_CLIENT_BAR_MS,
  INTRADAY_PREFETCH_LOW_WATER,
  playbackArgs,
  drawnThroughIndex,
  shouldPrefetch,
  anchorOriginMs,
  commitPause,
  settlementView,
  tradeControls,
  clickShouldSend,
  queuedActAllowed,
  playbackGate,
  resumeCatchUpAction,
  classifyFinishFailure,
  formatReturnPpm,
  hudReturnLabel,
} from '../js/intraday.js';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

test('boot stages and chart box reserve 320px without booting ECharts', () => {
  assert.deepEqual(INTRADAY_BOOT_STAGES, ['加载模块', '创建会话', '缓冲分时', '图表就绪']);
  const css = read('css/intraday.css');
  assert.match(css, /#intradayScreen\s+#intradayChart\s*\{[^}]*min-height:\s*320px/);
  assert.equal(css.includes('.lane'), false);
  assert.equal(css.includes('#gameScreen'), false);

  const html = read('index.html');
  const start = html.indexOf('id="intradayScreen"');
  const end = html.indexOf('id="gameScreen"');
  assert.ok(start > 0 && end > start);
  const section = html.slice(start, end);
  assert.match(section, /\shidden\b/);
  assert.equal(section.includes('active'), false);
  assert.match(section, /加载模块/);
  assert.match(section, />买入</);
  assert.match(section, />卖出</);
  assert.equal(section.includes('观望'), false);
  assert.equal(section.includes('2x'), false);
  assert.equal(section.includes('4x'), false);
  assert.equal(section.includes('intraday-mode-lane'), false);
  assert.match(html, /class="lane intraday-mode-lane"/);
  assert.equal(html.includes('intraday.js'), false);

  const player = read('js/intraday.js');
  const chart = read('js/intraday-chart.js');
  assert.equal(chart.includes('echarts'), false);
  assert.match(player, /ensureEcharts\(/);
  assert.equal(player.includes('resultScreen'), false);
  const home = read('js/home-ia.js');
  assert.equal(/from\s+['"]\.\/intraday\.js['"]/.test(home), false);
  assert.match(home, /import\(\s*['"]\.\/intraday\.js['"]\s*\)/);
  assert.equal(read('js/game.js').includes('intraday.js'), false);
  assert.equal(Route.INTRADAY, 'intraday');
  assert.equal(resolveHashRoute('intraday'), null);
});

test('playback stays on a 100ms clock when the buffer is behind', () => {
  assert.equal(INTRADAY_CLIENT_BAR_MS, 100);
  assert.equal(INTRADAY_PREFETCH_LOW_WATER, 8);
  const args = playbackArgs({ originMs: 1_000, nowMs: 5_000, barCount: 241, pausedAtMs: null });
  assert.equal(args.intervalMs, 100);
  assert.equal(drawnThroughIndex(19, 40), 19);
  assert.equal(shouldPrefetch({ cursor: 19, released: 40, inFlight: false, originKnown: true }), true);
  assert.equal(shouldPrefetch({ cursor: 40, released: 40, inFlight: false, originKnown: true }), false);
  assert.equal(shouldPrefetch({ cursor: 19, released: 40, inFlight: true, originKnown: true }), false);
  const behindInput = {
    cursor: 19,
    released: 40,
    originMs: 1_000,
    nowMs: 1_000 + 20 * 100,
    position: 'empty',
    actedBar: null,
    limitUpFen: 99999,
    limitDownFen: 1,
    closeFen: 100,
    settled: false,
  };
  // Bar 19's deadline is origin + 20*100 + 400. The clock has moved; the delivered bar stays open.
  const behind = tradeControls(behindInput);
  assert.equal(behind.buyEnabled, true);
  assert.equal(behind.barIndex, 19);
  assert.equal(behind.prefetchOnly, true);
  assert.equal(clickShouldSend(behind, 'buy'), true);
  assert.equal(clickShouldSend.toString().includes('prefetchOnly'), false);
  const ahead = tradeControls({
    ...behindInput,
    cursor: 12,
    released: 3,
    nowMs: 1_000 + 3 * 100 + 50,
  });
  assert.equal(ahead.buyEnabled, true);
  assert.equal(ahead.barIndex, 3);
  assert.equal(ahead.prefetchOnly, false);
  const slackOver = tradeControls({ ...behindInput, nowMs: 1_000 + 20 * 100 + 400 });
  assert.equal(slackOver.buyEnabled, false);
  assert.equal(slackOver.barIndex, null);
  assert.equal(slackOver.prefetchOnly, true);
  assert.equal(queuedActAllowed({
    originMs: 1_000,
    nowMs: 1_499,
    cursor: 4,
    barIndex: 0,
    acted: false,
  }), true);
  assert.equal(queuedActAllowed({
    originMs: 1_000,
    nowMs: 1_499,
    cursor: 0,
    barIndex: 3,
    acted: false,
  }), false);
  assert.equal(queuedActAllowed({
    originMs: 1_000,
    nowMs: 1_500,
    cursor: 4,
    barIndex: 0,
    acted: false,
  }), false);

  const delivered = {
    cursor: 0,
    released: 0,
    originMs: 1_000,
    nowMs: 1_499,
    position: 'empty',
    actedBar: null,
    limitUpFen: 50_000,
    limitDownFen: 1,
    closeFen: 100,
    settled: false,
  };
  const open = tradeControls(delivered);
  assert.equal(open.buyEnabled, true);
  assert.equal(open.barIndex, 0);
  const closed = tradeControls({ ...delivered, nowMs: 1_500 });
  assert.equal(closed.buyEnabled, false);

  const player = read('js/intraday.js');
  const onActSrc = player.slice(player.indexOf('function onAct'), player.indexOf('function onPause'));
  assert.equal(onActSrc.includes('prefetchOnly'), false);
  assert.match(onActSrc, /clickShouldSend/);

  const catchUp = player.slice(player.indexOf('async function catchUpPrefetch'), player.indexOf('function enqueuePrefetch'));
  const prefetchAt = catchUp.indexOf('prefetchOnce');
  const anchorAt = catchUp.indexOf('anchorOriginMs');
  assert.ok(prefetchAt >= 0 && anchorAt > prefetchAt);

  assert.deepEqual(
    resumeCatchUpAction({ originKnown: false, pauseKnown: true, pausedAtMs: null, gained: null }),
    { prefetch: true, anchor: false, basis: null },
  );
  assert.equal(
    resumeCatchUpAction({ originKnown: false, pauseKnown: true, pausedAtMs: null, gained: 20 }).anchor,
    false,
  );
  assert.equal(
    resumeCatchUpAction({ originKnown: false, pauseKnown: true, pausedAtMs: 5_000, gained: 4 }).basis,
    'pausedAtMs',
  );
  assert.equal(
    resumeCatchUpAction({ originKnown: false, pauseKnown: true, pausedAtMs: null, gained: 4 }).basis,
    'wall',
  );
  const staleOrigin = anchorOriginMs({ nowMs: 50_000, cursor: 5 });
  const staleReleased = Math.floor((50_000 - staleOrigin) / 100);
  assert.equal(staleReleased, 5);
  assert.equal(shouldPrefetch({
    cursor: 5,
    released: staleReleased,
    inFlight: false,
    originKnown: true,
  }), false);
});

test('pause and score stay uncommitted when the server rejects them', () => {
  const clock = { originMs: 5_000, pausedAtMs: null };
  assert.deepEqual(commitPause(clock, { ok: false, pause: true, serverNowMs: 9_000 }), clock);
  assert.deepEqual(
    commitPause(clock, { ok: true, pause: true, serverNowMs: 9_000 }),
    { originMs: 5_000, pausedAtMs: 9_000 },
  );
  assert.deepEqual(
    commitPause({ originMs: 5_000, pausedAtMs: 9_000 }, { ok: true, pause: false, serverNowMs: 12_000 }),
    { originMs: 8_000, pausedAtMs: null },
  );
  assert.equal(settlementView({ code: 'SUBMISSION_CONFLICT', returnPpm: 123 }), null);
  assert.equal(settlementView({ ok: false }), null);
  assert.equal(settlementView({ returnPpm: 0 }).returnPpm, 0);
  assert.equal(formatReturnPpm(12345), '+1.23%');
  const anchored = anchorOriginMs({ nowMs: 10_000, cursor: 0 });
  assert.equal(anchored, 10_000 - 99);

  assert.deepEqual(playbackGate({ pauseKnown: false, pausedAtMs: null }), {
    advanceClock: false,
    prefetchLoop: false,
    finish: false,
  });
  assert.deepEqual(playbackGate({ pauseKnown: true, pausedAtMs: 5_000 }), {
    advanceClock: false,
    prefetchLoop: false,
    finish: false,
  });
  assert.deepEqual(playbackGate({ pauseKnown: true, pausedAtMs: null }), {
    advanceClock: true,
    prefetchLoop: true,
    finish: true,
  });
  const frozenAnchor = anchorOriginMs({ nowMs: 5_000, cursor: 4 });
  assert.equal(frozenAnchor, 5_000 - (4 * 100 + 99));

  assert.equal(classifyFinishFailure({ code: 'SUBMISSION_CONFLICT', status: 409 }), 'latch');
  assert.equal(classifyFinishFailure({ code: 'GAME_NOT_ACTIVE', status: 409 }), 'latch');
  assert.equal(classifyFinishFailure({ code: 'INTERNAL', status: 500 }), 'retry');
  assert.equal(classifyFinishFailure({ status: 503 }), 'retry');
  assert.equal(classifyFinishFailure({ code: 'TAPE_NOT_FINISHED', status: 409 }), 'retry');
  assert.equal(classifyFinishFailure(new TypeError('fetch failed')), 'retry');
  assert.equal(settlementView({ code: 'SUBMISSION_CONFLICT', returnPpm: 10 }), null);
  assert.equal(settlementView({ returnPpm: 10 }).returnPpm, 10);

  assert.equal(hudReturnLabel({ settled: false, markReturnPpm: 0 }), '盯市 0.00%');
  assert.equal(hudReturnLabel({ settled: true, returnPpm: -2500 }), '结算（含收盘卖出费用） -0.25%');
  assert.equal(/^盯市 /.test(hudReturnLabel({ settled: false, markReturnPpm: 10 })), true);
  assert.equal(/^结算（含收盘卖出费用） /.test(hudReturnLabel({ settled: true, returnPpm: 10 })), true);
  const player = read('js/intraday.js');
  const sync = player.slice(player.indexOf('function syncHud'), player.indexOf('function paintSettlement'));
  const settle = player.slice(player.indexOf('function paintSettlement'), player.indexOf('function enqueueFinish'));
  assert.match(sync, /hudReturnLabel\(\{ settled: false/);
  assert.match(settle, /hudReturnLabel\(\{ settled: true/);
  assert.match(settle, /hudReturnLabel\(\{ settled: false/);
});
