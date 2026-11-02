import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegretModel,
  regretCopy,
  regretEligible,
  windowFromSession,
  pickPersona,
  pickLeak,
  againHint,
  againHintForGuest,
  PERSONAS,
  NEAR_ZERO_PTS,
  REGRET_FOOTNOTE,
} from '../js/regret-pure.js';
import { optimalActions } from '../shared/reviewEngine.js';
import { settleGame } from '../shared/engine.js';

/* ---------- fixtures ---------- */

/** 30 bars from closes: open = previous close, small wicks. */
function mkBars(closes) {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: o, close: c, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, volume: 1000 };
  });
}
const line = (from, to) => Array.from({ length: 30 }, (_, i) => from + ((to - from) * i) / 29);
const holds = () => Array.from({ length: 29 }, () => 'hold');
const FILL = 'next_open';

const up = mkBars(line(10, 13));
const down = mkBars(line(10, 7));

/* ---------- eligibility / window ---------- */

test('classic and 韭币局 (开一局) get the card; the capped / special modes do not', () => {
  assert.equal(regretEligible({ gameKind: null }), true);
  assert.equal(regretEligible({}), true);
  assert.equal(regretEligible({ gameKind: 'classic' }), true);
  assert.equal(regretEligible({ gameKind: 'stake' }), true, '开一局 = 韭币局 when live: same rules as classic');
  for (const k of ['oneshot', 'survival', 'daily', 'puzzle', 'ghost']) {
    assert.equal(regretEligible({ gameKind: k }), false, k);
  }
  assert.equal(regretEligible({ gameKind: null, maxOrders: 2 }), false, 'capped-order games have a different optimum');
});

test('windowFromSession slices the 30 game bars after the history and needs all 29 actions', () => {
  const history = mkBars(line(9, 10)).slice(0, 20);
  const view = { gameKline: [...history, ...up], historyLength: 20 };
  const w = windowFromSession(view, holds());
  assert.equal(w.bars.length, 30);
  assert.equal(w.bars[0].close, up[0].close);
  assert.equal(windowFromSession(view, holds().slice(0, 10)), null, 'unfinished game');
  assert.equal(windowFromSession({ gameKline: up.slice(0, 12), historyLength: 0 }, holds()), null, 'short window (puzzle)');
  assert.equal(windowFromSession(null, holds()), null);
  assert.equal(windowFromSession({ gameKline: up, historyLength: 'x' }, holds()), null);
});

/* ---------- model: engine-driven ---------- */

test('sat out a rising market: full regret, 空仓观众, biggest leak is 空仓错过', () => {
  const m = buildRegretModel({ fillMode: FILL, bars: up, actions: holds() });
  assert.equal(m.state, 'regret');
  assert.equal(m.buys, 0);
  assert.ok(m.optPct > 20, `optimal ${m.optPct}`);
  assert.equal(m.minePct, 0);
  assert.equal(m.regretPts, Math.round(m.optPct * 10) / 10);
  assert.equal(m.capturePct, 0);
  assert.equal(m.persona.key, 'watcher');
  assert.equal(m.leak.key, 'missed');
  assert.match(m.leak.text, /一笔没下/);
  assert.equal(m.again, `补回这 ${Math.round(m.regretPts)}%`);
});

test('playing the optimal route: 几乎零遗憾 + 神仙盘感, no leak, hint comes from the persona', () => {
  const opt = optimalActions({ fillMode: FILL, bars: up });
  const m = buildRegretModel({ fillMode: FILL, bars: up, actions: opt.actions });
  assert.equal(m.state, 'near');
  assert.ok(m.regretPts < NEAR_ZERO_PTS);
  assert.equal(m.capturePct, 100);
  assert.equal(m.persona.key, 'god');
  assert.equal(m.leak, null);
  assert.equal(m.again, '挑战满分');
});

test('a falling market nothing could beat: state none, nothing to regret', () => {
  const m = buildRegretModel({ fillMode: FILL, bars: down, actions: holds() });
  assert.equal(m.state, 'none');
  assert.equal(m.regretPts, 0);
  assert.equal(m.capturePct, null);
  assert.equal(m.persona.key, 'wise', 'staying out was right, so not 空仓观众');
  assert.equal(m.leak, null);
  const c = regretCopy(m);
  assert.equal(c.big, '空仓不动');
  assert.equal(c.barLabel, null);
});

test('bought and held a falling market: nothing to regret, but a 钉子户', () => {
  const actions = holds();
  actions[0] = 'buy';
  const m = buildRegretModel({ fillMode: FILL, bars: down, actions });
  assert.equal(m.state, 'none');
  assert.ok(m.minePct < -20);
  assert.equal(m.persona.key, 'nail');
  assert.match(regretCopy(m).explain, /送钱/);
});

test('regret is always optimal − mine, never negative, and the bar never exceeds 100', () => {
  let checked = 0;
  const seen = new Set();
  for (let seed = 1; seed <= 25; seed++) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let px = 10;
    const closes = Array.from({ length: 30 }, () => (px *= 1 + (rnd() - 0.5) * 0.08));
    const bars = mkBars(closes);
    // Legal sequences only: buy while flat, sell while holding (one day later at the earliest).
    let holding = false;
    let boughtOn = -1;
    const actions = Array.from({ length: 29 }, (_, i) => {
      const r = rnd();
      if (!holding && r < 0.3) { holding = true; boughtOn = i; return 'buy'; }
      if (holding && i > boughtOn && r < 0.3) { holding = false; return 'sell'; }
      return 'hold';
    });
    assert.ok(settleGame({ fillMode: FILL, bars, actions }).ok, 'generator must only produce legal games');
    checked++;
    const m = buildRegretModel({ fillMode: FILL, bars, actions });
    assert.ok(m, 'a legal classic game always yields a model');
    seen.add(m.persona.key);
    assert.ok(m.regretPts >= 0);
    if (m.capturePct != null) assert.ok(m.capturePct >= 0 && m.capturePct <= 100);
    assert.ok(m.persona && m.persona.name);
    if (m.state === 'regret') assert.ok(m.regretPts >= NEAR_ZERO_PTS - 0.05);
  }
  assert.equal(checked, 25, 'every seed must actually be checked');
  assert.ok(seen.size >= 3, `expected a spread of personas, got ${[...seen]}`);
});

test('never throws: bad input hides the card', () => {
  assert.equal(buildRegretModel({ fillMode: FILL, bars: up, actions: holds().slice(0, 5) }), null);
  assert.equal(buildRegretModel({ fillMode: FILL, bars: up.slice(0, 10), actions: holds() }), null);
  assert.equal(buildRegretModel({ fillMode: 'bogus', bars: up, actions: holds() }), null);
  assert.equal(buildRegretModel({ fillMode: FILL, bars: up, actions: holds(), gameKind: 'survival' }), null);
  assert.equal(buildRegretModel({}), null);
  // illegal sequence: sell while flat
  const bad = holds();
  bad[3] = 'sell';
  assert.equal(buildRegretModel({ fillMode: FILL, bars: up, actions: bad }), null);
});

/* ---------- personas (rule order) ---------- */

const trip = (over = {}) => ({ held: false, tags: [], ...over });
const base = { optPct: 20, minePct: 5, capturePct: 25, buys: 2, trips: [trip(), trip()] };

test('persona rule order: first match wins', () => {
  assert.equal(pickPersona({ ...base, capturePct: 85, minePct: 17, buys: 0, trips: [] }).key, 'god', '神仙盘感 beats everything');
  assert.equal(pickPersona({ ...base, buys: 0, trips: [], minePct: 0, capturePct: 0 }).key, 'watcher');
  assert.equal(pickPersona({ ...base, buys: 1, trips: [trip({ held: true, tags: ['追高'] })] }).key, 'nail', '钉子户 before 追高');
  assert.equal(pickPersona({ ...base, trips: [trip({ tags: ['追高'] }), trip()] }).key, 'chaser', 'half of the buys chased');
  assert.equal(pickPersona({ ...base, trips: [trip({ tags: ['追高'] }), trip(), trip()], buys: 3 }).key, 'steady', 'a third is not "half"');
  assert.equal(pickPersona({ ...base, trips: [trip({ tags: ['割在底部', '卖飞'] }), trip()] }).key, 'cutter', '割肉 before 卖飞');
  assert.equal(pickPersona({ ...base, trips: [trip({ tags: ['卖飞'] }), trip()] }).key, 'flyer');
  assert.equal(pickPersona({ ...base, buys: 5, trips: Array.from({ length: 5 }, () => trip()) }).key, 'busy');
  assert.equal(pickPersona({ ...base, buys: 4, trips: Array.from({ length: 4 }, () => trip()) }).key, 'steady');
});

test('persona edge cases: a barely-positive god needs a real optimum; big losses are not 稳扎稳打', () => {
  // optimal is only +0.3%: 80% of nothing is not "神仙盘感"
  assert.notEqual(pickPersona({ optPct: 0.3, minePct: 0.3, capturePct: 100, buys: 1, trips: [trip()] }).key, 'god');
  assert.equal(pickPersona({ ...base, minePct: -3, trips: [trip(), trip()] }).key, 'steady');
  assert.equal(pickPersona({ ...base, minePct: -8, trips: [trip(), trip()] }).key, 'explorer');
  assert.equal(pickPersona({ optPct: 0, minePct: 0, capturePct: null, buys: 0, trips: [] }).key, 'wise');
});

test('every persona has a name, one line and a tip; the eight named ones are all reachable', () => {
  for (const p of Object.values(PERSONAS)) {
    assert.ok(p.name && p.line && p.tip, p.key);
    assert.ok(p.name.length <= 6, `${p.name} must fit the big chip`);
  }
  const named = ['god', 'watcher', 'nail', 'chaser', 'cutter', 'flyer', 'busy', 'steady'];
  assert.deepEqual(named.map((k) => PERSONAS[k].name), ['神仙盘感', '空仓观众', '钉子户', '追高侠', '割肉达人', '卖飞选手', '手比脑子快', '稳扎稳打']);
});

/* ---------- leak / copy ---------- */

test('pickLeak names the biggest gap and stays quiet when none is big enough', () => {
  assert.equal(pickLeak({ gap: { missed: 3, stayed: 9, spread: 1 }, buys: 2 }).key, 'stayed');
  assert.equal(pickLeak({ gap: { missed: 2, stayed: 1, spread: 8 }, buys: 2 }).label, '进出场价差');
  assert.equal(pickLeak({ gap: { missed: 0.2, stayed: 0.1, spread: 0.3 }, buys: 2 }), null);
  assert.equal(pickLeak({ gap: null, buys: 0 }), null);
  assert.match(pickLeak({ gap: { missed: 5, stayed: 0, spread: 0 }, buys: 2 }).text, /在场的日子/);
});

test('regretCopy: one string set per state', () => {
  const regret = regretCopy({ state: 'regret', optPct: 18, minePct: 0, regretPts: 18, capturePct: 0, buys: 0, leak: { label: '空仓错过', text: '三十天一笔没下，最好的一波行情全在看戏。' }, persona: PERSONAS.watcher });
  assert.equal(regret.big, '+18.0%');
  assert.equal(regret.bigTone, 'bad');
  assert.equal(regret.meta, '最优 +18.0% · 你 +0.0%');
  assert.equal(regret.barLabel, '你拿到最优的 0%');
  assert.match(regret.explain, /^最大遗憾：空仓错过。/);

  const near = regretCopy({ state: 'near', optPct: 20, minePct: 19.6, regretPts: 0.4, capturePct: 98, buys: 2, leak: null, persona: PERSONAS.god });
  assert.equal(near.big, '几乎零遗憾');
  assert.equal(near.bigTone, 'good');
  assert.equal(near.barLabel, '你拿到最优的 98%');

  const none = regretCopy({ state: 'none', optPct: 0, minePct: -3.2, regretPts: 0, capturePct: null, buys: 2, leak: null, persona: PERSONAS.busy });
  assert.equal(none.big, '空仓不动');
  assert.match(none.meta, /−3\.2%/);

  assert.equal(regretCopy(null), null);
});

test('the red number uses the same unit as the headline return (percent, one decimal)', () => {
  const c = regretCopy({ state: 'regret', optPct: 23.46, minePct: 2.1, regretPts: 21.4, capturePct: 9, buys: 1, leak: null, persona: PERSONAS.flyer });
  assert.equal(c.big, '+21.4%');
  assert.equal(c.meta, '最优 +23.5% · 你 +2.1%');
});

test('againHint: regret → "补回这 N%"; tiny regret / near / none → the persona tip; guests are told to register', () => {
  assert.equal(againHint({ state: 'regret', regretPts: 21.4, persona: PERSONAS.flyer }), '补回这 21%');
  assert.equal(againHint({ state: 'regret', regretPts: 0.7, persona: PERSONAS.steady }), '冲更高的分', 'under 1 point there is nothing to "make up"');
  assert.equal(againHint({ state: 'near', regretPts: 0.2, persona: PERSONAS.god }), '挑战满分');
  assert.equal(againHint({ state: 'none', regretPts: 0, persona: PERSONAS.wise }), '换个行情试试');
  assert.equal(againHint({ state: 'none', regretPts: 0, persona: null }), '');
  assert.equal(againHintForGuest('补回这 18%'), '补回这 18% · 注册后继续');
  assert.equal(againHintForGuest(''), '注册后继续');
  assert.match(REGRET_FOOTNOTE, /事后/);
});
