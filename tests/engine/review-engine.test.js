import test from 'node:test';
import assert from 'node:assert/strict';
import { settleGame } from '../../shared/engine.js';
import {
  optimalActions, exposureByDay, holdCurve, attributeGap, roundTrips, judgeTrip, routeSteps, buildReview, reviewTeaser,
} from '../../shared/reviewEngine.js';
import { makeBars, holds } from '../../shared/fixtures/golden.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Random walk window; `liveDays` days of movement, then dead flat (so brute force over the first days is exhaustive). */
function walkBars(seed, liveDays = 30) {
  const r = lcg(seed);
  let px = 20 + r() * 20;
  const bars = [];
  for (let d = 1; d <= 30; d++) {
    if (d > liveDays) {
      bars.push({ open: px, high: px, low: px, close: px, date: `d${d}`, volume: 1 });
      continue;
    }
    const open = px * (1 + (r() - 0.5) * 0.04);
    const close = open * (1 + (r() - 0.5) * 0.08);
    const high = Math.max(open, close) * (1 + r() * 0.02);
    const low = Math.min(open, close) * (1 - r() * 0.02);
    bars.push({ open, high, low, close, date: `d${d}`, volume: 1 });
    px = close;
  }
  return bars;
}

function allSequences(len) {
  const out = [];
  const rec = (acc) => {
    if (acc.length === len) { out.push(acc); return; }
    for (const a of ['hold', 'buy', 'sell']) rec([...acc, a]);
  };
  rec([]);
  return out;
}

const pad = (a) => [...a, ...holds(29 - a.length)];

for (const fillMode of ['next_open', 'same_close']) {
  test(`${fillMode}: DP equals brute force over every legal sequence`, () => {
    const seqs = allSequences(8);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const bars = walkBars(seed, 9);
      let best = 1;
      let bestBuys = Infinity;
      for (const s of seqs) {
        const r = settleGame({ fillMode, bars, actions: pad(s) });
        if (!r.ok) continue;
        if (r.equityMultiple > best + 1e-12) { best = r.equityMultiple; }
      }
      const opt = optimalActions({ fillMode, bars });
      const rep = settleGame({ fillMode, bars, actions: opt.actions });
      assert.ok(rep.ok, `optimal path must be legal (seed ${seed})`);
      assert.ok(Math.abs(rep.equityMultiple - best) < 1e-9, `seed ${seed}: dp ${rep.equityMultiple} vs brute ${best}`);
      assert.ok(Math.abs(opt.multiple - best) < 1e-9);
      void bestBuys;
    }
  });

  test(`${fillMode}: optimal is never beaten by random legal play and always legal`, () => {
    for (let seed = 10; seed < 40; seed++) {
      const bars = walkBars(seed);
      const opt = optimalActions({ fillMode, bars });
      const rep = settleGame({ fillMode, bars, actions: opt.actions });
      assert.ok(rep.ok, `seed ${seed}`);
      assert.ok(rep.equityMultiple >= 1 - 1e-12, 'never worse than staying out');
      const r = lcg(seed * 7);
      for (let n = 0; n < 150; n++) {
        const acts = [];
        let held = false;
        for (let d = 0; d < 29; d++) {
          const x = r();
          if (!held && x < 0.2) { acts.push('buy'); held = true; }
          else if (held && x < 0.25 && acts.lastIndexOf('buy') < d) { acts.push('sell'); held = false; }
          else acts.push('hold');
        }
        const m = settleGame({ fillMode, bars, actions: acts });
        if (m.ok) assert.ok(m.equityMultiple <= rep.equityMultiple + 1e-9, `seed ${seed} random beat optimal`);
      }
    }
  });
}

test('maxBuys=1 (一把梭) caps the route at one buy and is optimal under the cap', () => {
  for (const fillMode of ['next_open', 'same_close']) {
    const seqs = allSequences(8).filter((s) => s.filter((a) => a === 'buy').length <= 1);
    for (const seed of [21, 22, 23]) {
      const bars = walkBars(seed, 9);
      let best = 1;
      for (const s of seqs) {
        const r = settleGame({ fillMode, bars, actions: pad(s) });
        if (r.ok && r.equityMultiple > best) best = r.equityMultiple;
      }
      const opt = optimalActions({ fillMode, bars, maxBuys: 1 });
      assert.ok(opt.actions.filter((a) => a === 'buy').length <= 1);
      assert.ok(Math.abs(opt.multiple - best) < 1e-9, `${fillMode} seed ${seed}`);
    }
  }
});

test('a falling market: the best play is to do nothing', () => {
  const o = {};
  for (let d = 1; d <= 30; d++) o[d] = { open: 20 - d * 0.3, close: 20 - d * 0.3 - 0.1 };
  const bars = makeBars(o);
  const opt = optimalActions({ fillMode: 'next_open', bars });
  assert.deepEqual(opt.actions, holds(29));
  assert.equal(opt.multiple, 1);
});

test('T+1: a one-day spike cannot be bought and sold the same day', () => {
  // day 5 close spikes then back; same_close: buy day 5 close, sell day 6 earliest.
  const bars = makeBars({ 5: { open: 10, close: 15 }, 6: { open: 15, close: 10 } });
  const opt = optimalActions({ fillMode: 'same_close', bars });
  const rep = settleGame({ fillMode: 'same_close', bars, actions: opt.actions });
  assert.ok(rep.ok);
  for (let i = 0; i < rep.trades.length - 1; i++) {
    if (rep.trades[i].type === 'buy' && rep.trades[i + 1].type === 'sell') assert.ok(rep.trades[i + 1].day > rep.trades[i].day);
  }
});

test('exposureByDay follows fill days', () => {
  const acts = holds(29);
  acts[2] = 'buy'; // decision day 3
  acts[9] = 'sell'; // decision day 10
  const no = exposureByDay({ fillMode: 'next_open', actions: acts });
  assert.equal(no[3], false);
  assert.equal(no[4], true);
  assert.equal(no[10], true);
  assert.equal(no[11], false);
  const sc = exposureByDay({ fillMode: 'same_close', actions: acts });
  assert.equal(sc[3], true);
  assert.equal(sc[9], true);
  assert.equal(sc[10], false);
});

test('hold curve matches the buy&hold benchmark convention', () => {
  const bars = makeBars({ 2: { open: 10, close: 11 }, 30: { open: 12, close: 12 } });
  assert.equal(holdCurve({ fillMode: 'next_open', bars })[0], 1);
  assert.equal(holdCurve({ fillMode: 'next_open', bars })[1], 1);
  assert.ok(Math.abs(holdCurve({ fillMode: 'next_open', bars })[30] - 1.2) < 1e-9);
  assert.ok(Math.abs(holdCurve({ fillMode: 'same_close', bars })[30] - 1.2) < 1e-9);
});

test('gap attribution adds up to optimal − mine', () => {
  for (const fillMode of ['next_open', 'same_close']) {
    for (let seed = 50; seed < 70; seed++) {
      const bars = walkBars(seed);
      const r = lcg(seed);
      const mine = [];
      let held = false;
      for (let d = 0; d < 29; d++) {
        const x = r();
        if (!held && x < 0.15) { mine.push('buy'); held = true; }
        else if (held && x < 0.2 && mine.lastIndexOf('buy') < d) { mine.push('sell'); held = false; }
        else mine.push('hold');
      }
      if (!settleGame({ fillMode, bars, actions: mine }).ok) continue;
      const rv = buildReview({ fillMode, bars, actions: mine });
      const g = rv.gap;
      assert.ok(Math.abs(g.missed + g.stayed + g.spread - g.gapPct) < 0.03, `seed ${seed}: ${JSON.stringify(g)}`);
      assert.ok(g.gapPct >= -0.01);
      assert.ok(rv.optimal.returnPct >= rv.mine.returnPct - 0.01);
      assert.equal(rv.mine.curve.length, 31);
      assert.equal(rv.optimal.curve.length, 31);
      assert.equal(rv.hold.curve.length, 31);
    }
  }
});

test('review of the optimal play itself has no gap and says so', () => {
  const bars = walkBars(77);
  const opt = optimalActions({ fillMode: 'next_open', bars });
  const rv = buildReview({ fillMode: 'next_open', bars, actions: opt.actions });
  assert.equal(rv.gap.gapPct, 0);
  assert.match(rv.insights[0], /一样好|赚不到/);
});

test('trip judging tags: chasing the high, selling too early, cutting at the bottom', () => {
  // climb 10 → 20 over days 1..10, buy at the top (day 10), crash, then rebound.
  const o = {};
  for (let d = 1; d <= 10; d++) o[d] = { open: 10 + d, close: 10 + d };
  for (let d = 11; d <= 14; d++) o[d] = { open: 20 - (d - 11) * 2, close: 20 - (d - 11) * 2 };
  for (let d = 15; d <= 30; d++) o[d] = { open: 24, close: 24 };
  const bars = makeBars(o);
  const acts = holds(29);
  acts[9] = 'buy'; // day 10 decision → fills day 11 open at 20 (the top)
  acts[12] = 'sell'; // day 13 decision → fills day 14 open (14)
  const trips = roundTrips({ fillMode: 'next_open', bars, actions: acts });
  assert.equal(trips.length, 1);
  const j = judgeTrip({ bars, fillMode: 'next_open' }, trips[0]);
  assert.ok(j.returnPct < 0);
  assert.ok(j.tags.includes('割在底部'), JSON.stringify(j));
  assert.ok(j.tags.includes('追高'), JSON.stringify(j));
  assert.ok(j.bestExitReturnPct > 0);
});

test('routeSteps: one stop per optimal order, ordered, reasons present, prices match the engine fills', () => {
  for (const fillMode of ['next_open', 'same_close']) {
    for (let seed = 90; seed < 100; seed++) {
      const bars = walkBars(seed);
      const opt = optimalActions({ fillMode, bars });
      const steps = routeSteps({ fillMode, bars, actions: opt.actions });
      const orders = opt.actions.map((a, i) => [a, i + 1]).filter(([a]) => a !== 'hold');
      assert.equal(steps.length, orders.length, `${fillMode} ${seed}`);
      const rep = settleGame({ fillMode, bars, actions: opt.actions });
      steps.forEach((st, i) => {
        assert.equal(st.action, orders[i][0]);
        assert.equal(st.day, orders[i][1]);
        assert.ok(st.reasons.length >= 1 && st.reasons.every((x) => typeof x === 'string' && x.length > 3 && !/NaN|undefined/.test(x)));
        assert.ok(Math.abs(st.price - Number(rep.trades[i].price.toFixed(2))) < 0.011);
        assert.equal(st.fillDay, rep.trades[i].day);
      });
    }
  }
});

test('buildReview rejects bad input and teaser matches review headline numbers', () => {
  const bars = walkBars(5);
  assert.throws(() => buildReview({ fillMode: 'next_open', bars, actions: holds(10) }));
  assert.throws(() => buildReview({ fillMode: 'bogus', bars, actions: holds(29) }));
  const acts = holds(29);
  acts[3] = 'buy';
  acts[10] = 'sell';
  const t = reviewTeaser({ fillMode: 'next_open', bars, actions: acts });
  const rv = buildReview({ fillMode: 'next_open', bars, actions: acts });
  assert.equal(t.optimalReturnPct, rv.optimal.returnPct);
  assert.equal(t.yourReturnPct, rv.mine.returnPct);
  assert.equal(t.capturePct, rv.capturePct);
  assert.deepEqual(Object.keys(t).sort(), ['capturePct', 'optimalReturnPct', 'yourReturnPct']);
});
