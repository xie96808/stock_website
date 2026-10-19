import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/lucky-wheel-pure.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('landing: every sector × jitter × start angle × velocity lands exactly on the server sector', () => {
  for (let k = 0; k < 8; k++) {
    for (const j of [-13, -7.3, 0, 0.1, 6.9, 13]) {
      for (const a of [0, 17.5, 359.9, 1234.5, 9999]) {
        for (const v of [300, 720]) {
          const plan = P.planDecel(a, v, k, j);
          assert.equal(P.sectorUnderPointer(plan.finalAngle), k, `k=${k} j=${j} a=${a}`);
          assert.ok(near(P.pointerOffsetFromCenter(plan.finalAngle), j), 'offset == jitter');
          assert.ok(plan.finalAngle - a >= 2 * 360 - 1e-9, 'at least 2 extra turns');
          assert.ok(near(P.mod360(plan.finalAngle), P.mod360(-(45 * k + j))), 'θ = 360n − (45k + j)');
        }
      }
    }
  }
});

test('landing: jitter is clamped to ±13° so the pointer never leaves the sector', () => {
  assert.equal(P.clampJitter(99), 13);
  assert.equal(P.clampJitter(-99), -13);
  assert.equal(P.clampJitter('x'), 0);
  const plan = P.planDecel(100, 720, 3, 50);
  assert.equal(P.sectorUnderPointer(plan.finalAngle), 3);
});

test('restAngle matches the MANIFEST convention θ = 360n − (45k + j)', () => {
  assert.equal(P.restAngle(0, 0, 5), 1800);
  assert.equal(P.restAngle(5, 7, 6), 2160 - 232);
  assert.equal(P.sectorUnderPointer(0), 0);
  assert.equal(P.sectorUnderPointer(-45), 1); // disc turned ccw by 45° → sector 1 is under the pointer
  assert.equal(P.sectorUnderPointer(-(45 * 5)), 5);
});

test('timeline: fast-reply total (cruise 1.3 s + decel + settle) stays inside 3.8–4.8 s for every sector/jitter', () => {
  const t = P.LW_T.minCruiseUntil;
  const a = P.leadAngle(t, 0);
  const v = P.leadVelocity(t);
  assert.equal(v, P.LW_T.cruiseDps);
  let min = Infinity;
  let max = 0;
  for (let k = 0; k < 8; k++) {
    for (let j = -13; j <= 13; j += 1) {
      for (const a0 of [0, 77, 180, 333]) {
        const plan = P.planDecel(P.leadAngle(t, a0), v, k, j);
        const total = t + plan.T + P.LW_T.settle;
        min = Math.min(min, total);
        max = Math.max(max, total);
        assert.ok(plan.n >= P.LW_T.nMin && plan.n <= P.LW_T.nMax);
      }
    }
  }
  assert.ok(min >= 3800 && max <= 4800, `total ${min}..${max}`);
  assert.ok(a > 0);
});

test('decel curve: monotone, ends at D, velocity continuous with the cruise', () => {
  const plan = P.planDecel(1000, 720, 5, 7);
  let prev = -1;
  for (let ms = 0; ms <= plan.T; ms += 20) {
    const x = P.decelOffset(ms, plan);
    assert.ok(x >= prev);
    prev = x;
  }
  assert.ok(near(P.decelOffset(plan.T, plan), plan.D, 1e-6));
  const dx = P.decelOffset(1, plan) - P.decelOffset(0, plan); // deg per ms
  assert.ok(Math.abs(dx * 1000 - 720) < 15, `initial speed ${dx * 1000}`);
  // lead phase velocity is continuous at the end of the acceleration
  assert.ok(near(P.leadVelocity(P.LW_T.windup + P.LW_T.accel - 1), 720, 3.5));
});

test('tickIndex changes once per divider crossing (every 45°)', () => {
  const seen = new Set();
  let changes = 0;
  let last = P.tickIndex(0);
  for (let a = 0; a <= 360; a += 0.5) {
    const t = P.tickIndex(a);
    if (t !== last) changes += 1;
    last = t;
    seen.add(t);
  }
  assert.equal(changes, 8);
});

test('sector colours: 8 distinct; label ink #26211d has >= 5.4:1 on every one (incl. cinnabar)', () => {
  assert.equal(new Set(P.LW_SECTOR_COLORS).size, 8);
  assert.equal(P.LW_INK, '#26211d');
  for (const c of P.LW_SECTOR_COLORS) assert.ok(P.contrastRatio(P.LW_INK, c) >= 5.4, `${c} ${P.contrastRatio(P.LW_INK, c)}`);
  assert.ok(P.contrastRatio('#3a3530', '#E4796A') < 4.5, 'documents why #3a3530 was rejected');
});

test('sector label / art mapping from server sector data', () => {
  assert.deepEqual(P.sectorLabel({ kind: 'jiu_coin', amount: 888 }), { text: '888', len: 3 });
  assert.equal(P.sectorLabel({ kind: 'item', item: 'rewind_ticket', qty: 2 }).text, '×2');
  assert.equal(P.sectorLabel({ kind: 'spin', qty: 1 }).text, '再转');
  assert.equal(P.artFile({ kind: 'jiu_coin', art: 'coin-t3' }), 'lw-prize-3');
  assert.equal(P.artFile({ kind: 'jiu_coin', art: 'coin-t5' }), 'lw-prize-5');
  assert.equal(P.artFile({ kind: 'item', art: 'ticket-x2' }), 'lw-prize-ticket-2');
  assert.equal(P.artFile({ kind: 'item', art: 'ticket-x3' }), 'lw-prize-ticket-3');
  assert.equal(P.artFile({ kind: 'spin', art: 'spin-again' }), 'lw-prize-spin');
  assert.equal(P.artFile({ kind: 'jiu_coin', amount: 888 }), 'lw-prize-5'); // art missing → tier from amount
  assert.equal(P.sectorAria({ kind: 'item', label: '后悔券', qty: 3 }), '后悔券 ×3');
});

test('pop-up copy: coin / jackpot / ticket / spin-again / substituted / replay', () => {
  const coin = P.prizeCopy({ kind: 'jiu_coin', amount: 150 });
  assert.equal(coin.kind, 'coin');
  assert.equal(coin.amount, 150);
  assert.equal(coin.title, '获得奖品');
  const jp = P.prizeCopy({ kind: 'jiu_coin', amount: 888, isJackpot: true }, { isJackpot: true });
  assert.equal(jp.title, '大奖！');
  assert.match(jp.headline, /大奖/);
  assert.equal(jp.amount, 888);
  const tk = P.prizeCopy({ kind: 'item', item: 'rewind_ticket', label: '后悔券', qty: 2 });
  assert.equal(tk.kind, 'ticket');
  assert.match(tk.headline, /后悔券 ×2/);
  assert.ok(tk.lines.some((l) => /背包/.test(l)));
  const again = P.prizeCopy({ kind: 'spin', qty: 1 }, { freeSpinsTotal: 1 });
  assert.equal(again.kind, 'spin');
  assert.equal(again.primary, '再转一次');
  assert.equal(again.secondary, '好的');
  const againNone = P.prizeCopy({ kind: 'spin', qty: 1 }, { freeSpinsTotal: 0 });
  assert.equal(againNone.primary, '好的');
  assert.equal(againNone.secondary, null);
  const subCap = P.prizeCopy({ kind: 'jiu_coin', amount: 60, substituted: true }, { drawnKind: 'spin' });
  assert.ok(subCap.lines.some((l) => /上限/.test(l)));
  const subItem = P.prizeCopy({ kind: 'jiu_coin', amount: 100, substituted: true }, { drawnKind: 'item' });
  assert.ok(subItem.lines.some((l) => /折算/.test(l)));
  const replay = P.prizeCopy({ kind: 'jiu_coin', amount: 90 }, { replayed: true });
  assert.ok(replay.lines.some((l) => /上一次/.test(l)));
});

test('idempotency key matches the server pattern and is unique', () => {
  const re = /^[A-Za-z0-9._:-]{8,128}$/;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const k = P.newIdemKey();
    assert.match(k, re);
    seen.add(k);
  }
  assert.equal(seen.size, 200);
});

test('spin error plan: network keeps the key (replay), definite errors drop it', () => {
  assert.equal(P.spinErrorPlan({}).keepKey, true);
  assert.equal(P.spinErrorPlan({ status: 500 }).keepKey, true);
  assert.equal(P.spinErrorPlan({ status: 429 }).keepKey, true);
  assert.equal(P.spinErrorPlan({ status: 409, code: 'NO_SPINS_LEFT' }).kind, 'noSpins');
  assert.equal(P.spinErrorPlan({ status: 409, code: 'NO_SPINS_LEFT' }).keepKey, false);
  assert.equal(P.spinErrorPlan({ status: 403, code: 'FEATURE_DISABLED' }).kind, 'disabled');
  assert.equal(P.spinErrorPlan({ status: 401 }).kind, 'auth');
});

test('reset countdown text', () => {
  const now = Date.parse('2026-10-19T10:00:00+08:00');
  assert.equal(P.resetCountdownText('2026-10-20T00:00:00+08:00', now), '14 小时 0 分后刷新');
  assert.equal(P.resetCountdownText('2026-10-19T10:20:00+08:00', now), '20 分钟后刷新');
  assert.equal(P.resetCountdownText(null, now), '北京时间 0 点刷新');
});
