import test from 'node:test';
import assert from 'node:assert/strict';
import { optimalActions, routeSteps, buildReview } from '../shared/reviewEngine.js';
import { settleGame } from '../shared/engine.js';
import {
  initialReplay, advance, acknowledge, runToEnd, stepOnDay, popupCopy, gapRows, curvePoints, curveRange, curvePct,
  teaserCopy, reviewAction, reviewErrorToast, REPLAY_DAYS,
} from '../js/route-replay-pure.js';

function walk(seed) {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let px = 30;
  const bars = [];
  for (let d = 1; d <= 30; d++) {
    const open = px * (1 + (r() - 0.5) * 0.04);
    const close = open * (1 + (r() - 0.5) * 0.08);
    bars.push({ open, close, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, date: `d${d}`, volume: 1 });
    px = close;
  }
  return bars;
}

for (const fillMode of ['next_open', 'same_close']) {
  test(`${fillMode}: stepping day by day pauses exactly on optimal order days and ends at day 30`, () => {
    for (let seed = 1; seed < 25; seed++) {
      const bars = walk(seed);
      const opt = optimalActions({ fillMode, bars });
      const route = routeSteps({ fillMode, bars, actions: opt.actions });
      let st = initialReplay();
      const pausedOn = [];
      let guard = 0;
      while (!st.done && guard++ < 200) {
        st = advance(route, fillMode, st);
        if (st.pause) {
          pausedOn.push(st.cur);
          assert.equal(advance(route, fillMode, st), st, 'cannot walk on while the popup is open');
          st = acknowledge(route, fillMode, st);
        }
      }
      assert.equal(st.cur, REPLAY_DAYS);
      assert.deepEqual(pausedOn, route.map((x) => x.day));
      // fills reproduce the engine's own trade list (same days and prices)
      const rep = settleGame({ fillMode, bars, actions: opt.actions });
      assert.equal(st.fills.length, rep.trades.length, `${fillMode} ${seed}`);
      st.fills.forEach((f, i) => {
        assert.equal(f.type, rep.trades[i].type);
        assert.equal(f.day, rep.trades[i].day);
        assert.ok(Math.abs(f.price - rep.trades[i].price) < 0.011);
      });
      assert.equal(st.pos, rep.valuation ? 'long' : 'flat');
    }
  });

  test(`${fillMode}: runToEnd gives the same fills as stepping`, () => {
    const bars = walk(7);
    const opt = optimalActions({ fillMode, bars });
    const route = routeSteps({ fillMode, bars, actions: opt.actions });
    const a = runToEnd(route, fillMode, initialReplay());
    assert.equal(a.done, true);
    assert.equal(a.fills.length, route.length);
  });
}

test('next_open fills land the day after the decision, same_close on the decision day', () => {
  const route = [{ day: 3, action: 'buy', fillDay: 4, price: 10, reasons: ['r'] }, { day: 6, action: 'sell', fillDay: 7, price: 12, reasons: ['r'] }];
  let st = initialReplay();
  for (let i = 0; i < 3; i++) { st = advance(route, 'next_open', st); if (st.pause) break; }
  assert.equal(st.cur, 3);
  assert.equal(st.pause.action, 'buy');
  assert.equal(st.pos, 'flat');
  st = acknowledge(route, 'next_open', st);
  assert.equal(st.pos, 'flat');
  st = advance(route, 'next_open', st);
  assert.equal(st.cur, 4);
  assert.equal(st.pos, 'long');
  assert.equal(st.entry, 10);

  const route2 = [{ day: 3, action: 'buy', fillDay: 3, price: 10, reasons: ['r'] }];
  let s2 = initialReplay();
  for (let i = 0; i < 3; i++) s2 = advance(route2, 'same_close', s2);
  assert.equal(s2.pause.day, 3);
  assert.equal(s2.pos, 'flat');
  s2 = acknowledge(route2, 'same_close', s2);
  assert.equal(s2.pos, 'long');
});

test('a route with no orders just walks to the end', () => {
  const st = runToEnd([], 'next_open', initialReplay());
  assert.equal(st.cur, 30);
  assert.equal(st.fills.length, 0);
  assert.equal(stepOnDay([], 3), null);
});

test('popup copy mentions the right fill moment and carries the reasons', () => {
  const step = { day: 5, action: 'buy', fillDay: 6, price: 12.345, reasons: ['a', 'b'] };
  const c = popupCopy(step, 'next_open');
  assert.equal(c.title, '这天该买入');
  assert.match(c.sub, /明天开盘买入/);
  assert.match(c.kicker, /第 5 天/);
  assert.deepEqual(c.reasons, ['a', 'b']);
  assert.match(popupCopy({ ...step, action: 'sell' }, 'same_close').sub, /今天收盘卖出/);
});

test('summary helpers: gap rows, curve points, range, percent', () => {
  const rows = gapRows({ missed: 6, stayed: 2.5, spread: 0.01, gapPct: 8.5 });
  assert.deepEqual(rows.map((r) => r.key), ['missed', 'stayed']);
  assert.equal(rows[0].width, 100);
  assert.ok(rows[1].width > 0 && rows[1].width < 100);
  assert.deepEqual(gapRows(null), []);
  const curve = Array.from({ length: 31 }, (_, i) => 1 + i * 0.01);
  const { yMin, yMax } = curveRange([curve, null]);
  assert.ok(yMin < 1 && yMax > 1.3);
  const pts = curvePoints(curve, 10, { width: 300, height: 100, yMin, yMax });
  assert.equal(pts.split(' ').length, 11);
  assert.ok(!/NaN/.test(pts));
  assert.equal(curvePoints(curve, -1, { width: 300, height: 100, yMin, yMax }), '');
  assert.ok(Math.abs(curvePct(curve, 10) - 10) < 1e-9);
  assert.equal(curvePct(curve, 99), curvePct(curve, 30));
  assert.equal(curvePct(null, 3), 0);
});

test('teaser copy and purchase button states', () => {
  assert.match(teaserCopy({ optimalReturnPct: 12, yourReturnPct: 3, capturePct: 25 }), /\+12\.00%.*25%/);
  assert.match(teaserCopy({ optimalReturnPct: 12, yourReturnPct: -3, capturePct: null }), /-3\.00%/);
  assert.match(teaserCopy({ optimalReturnPct: 0, yourReturnPct: -3, capturePct: null }), /空仓不动/);
  const route = { id: 'route', price: 30, owned: false, buyable: true };
  assert.equal(reviewAction(route, 100).label, '解锁 30');
  assert.equal(reviewAction(route, 100, true).label, '确认 -30');
  assert.deepEqual((({ kind, label }) => ({ kind, label }))(reviewAction(route, 12)), { kind: 'poor', label: '还差 18' });
  assert.equal(reviewAction({ ...route, owned: true }, 100).kind, 'owned');
  assert.equal(reviewAction({ id: 'hold', price: 10, owned: false, buyable: false }, 100).kind, 'locked');
  assert.equal(reviewErrorToast({ code: 'INSUFFICIENT_FUNDS' }), '韭币不足');
  assert.equal(reviewErrorToast(null), '操作失败，请稍后再试');
});

test('review payload route feeds the replay end to end', () => {
  const bars = walk(3);
  const actions = Array(29).fill('hold');
  actions[2] = 'buy';
  actions[9] = 'sell';
  const rv = buildReview({ fillMode: 'next_open', bars, actions });
  const st = runToEnd(rv.route, 'next_open', initialReplay());
  assert.equal(st.fills.length, rv.route.length);
  assert.ok(Math.abs(curvePct(rv.optimal.curve, 30) - rv.optimal.returnPct) < 0.01);
});
