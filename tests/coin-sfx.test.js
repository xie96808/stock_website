import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShower } from '../js/coin-sfx.js';
import { showerScore } from '../js/coin-gain-pure.js';

/** A minimal recording stand-in for a BaseAudioContext (node has no WebAudio). */
function fakeAudio(sampleRate = 44100) {
  const log = { osc: [], gains: [], filters: [], sources: [], buffers: [] };
  const param = (init = 0) => {
    const p = { value: init, calls: [] };
    p.setValueAtTime = (v, t) => { p.calls.push(['set', v, t]); };
    p.exponentialRampToValueAtTime = (v, t) => { p.calls.push(['ramp', v, t]); };
    return p;
  };
  const node = (extra = {}) => ({ connect(n) { this.out = n; return n; }, ...extra });
  const ctx = {
    sampleRate,
    createGain() { const g = node({ gain: param(1) }); log.gains.push(g); return g; },
    createOscillator() { const o = node({ type: '', frequency: param(0), start(t) { this.t0 = t; }, stop(t) { this.t1 = t; } }); log.osc.push(o); return o; },
    createBiquadFilter() { const f = node({ type: '', frequency: param(0), Q: param(0) }); log.filters.push(f); return f; },
    createBuffer(ch, n) { const d = new Float32Array(n); const b = { getChannelData: () => d, length: n }; log.buffers.push(b); return b; },
    createBufferSource() { const s = node({ start(t) { this.t0 = t; } }); log.sources.push(s); return s; },
  };
  return { ctx, log };
}

test('renderShower builds exactly the score: clinks × partials oscillators, a rustle + one clack per clink, all routed to the destination', () => {
  for (const amount of [20, 150, 800]) {
    const score = showerScore(amount, 3);
    const { ctx, log } = fakeAudio();
    const dest = { name: 'dest' };
    const end = renderShower(ctx, dest, 1.0, score);
    assert.equal(log.osc.length, score.clinks.length * score.partials.length);
    assert.equal(log.sources.length, 1 + score.clinks.length, 'rustle + one clack per clink');
    assert.equal(log.filters.length, 1 + score.clinks.length);
    assert.ok(Math.abs(end - (1.0 + score.end)) < 1e-9);
    assert.equal(log.gains[0].out, dest, 'master gain feeds the destination');
    assert.equal(log.buffers.length, 1, 'one shared noise bed');
    assert.ok(log.buffers[0].length >= Math.floor(44100 * score.end), 'the bed covers the whole sound');
    for (const o of log.osc) {
      assert.equal(o.type, 'sine');
      assert.ok(o.t0 >= 1.0, 'never scheduled before the start time');
      assert.ok(o.t1 > o.t0, 'every oscillator is stopped (no leak)');
      assert.ok(o.t1 <= end + 0.1);
    }
    for (const s of log.sources) assert.ok(s.t0 >= 1.0);
  }
});

test('every envelope starts silent and ends silent (no clicks, no hanging tone); nothing exceeds full scale', () => {
  const { ctx, log } = fakeAudio();
  renderShower(ctx, {}, 0, showerScore(800, 3));
  const clinkEnv = log.gains.filter((g) => g.gain.calls.length === 3 && g.gain.calls[1][0] === 'ramp' && g.gain.calls[0][1] < 0.001);
  assert.ok(clinkEnv.length >= 3 * 27, `${clinkEnv.length} clink envelopes`);
  for (const g of clinkEnv) {
    const [[, v0], [, peak], [, v1]] = g.gain.calls;
    assert.ok(v0 < 0.001 && v1 < 0.001);
    assert.ok(peak > 0 && peak <= 0.5, `peak ${peak}`);
  }
  const rustle = log.gains.find((g) => g.gain.calls.length === 4);
  assert.ok(rustle, 'the rustle envelope (swell, hold, trail off)');
  assert.ok(rustle.gain.calls[0][1] < 0.001 && rustle.gain.calls[3][1] < 0.001);
  assert.ok(rustle.gain.calls[1][1] <= 0.2, 'the rustle stays a bed, never the loudest thing');
});

test('the noise bed is deterministic (an offline render is repeatable)', () => {
  const a = fakeAudio(); renderShower(a.ctx, {}, 0, showerScore(20, 3));
  const b = fakeAudio(); renderShower(b.ctx, {}, 0, showerScore(20, 3));
  assert.deepEqual(Array.from(a.log.buffers[0].getChannelData(0).slice(0, 64)), Array.from(b.log.buffers[0].getChannelData(0).slice(0, 64)));
});
