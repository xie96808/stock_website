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
  formatReturnPpm,
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
  assert.equal(html.includes('intraday-mode-lane'), false);
  assert.equal(html.includes('intraday.js'), false);

  const player = read('js/intraday.js');
  const chart = read('js/intraday-chart.js');
  assert.equal(chart.includes('echarts'), false);
  assert.match(player, /ensureEcharts\(/);
  assert.equal(player.includes('resultScreen'), false);
  assert.equal(read('js/home-ia.js').includes('intraday.js'), false);
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
  const behind = tradeControls({
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
  });
  assert.equal(behind.buyEnabled, false);
  assert.equal(behind.sellEnabled, false);
  assert.equal(behind.prefetchOnly, true);

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
});
