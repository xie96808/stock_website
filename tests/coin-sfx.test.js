import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChime } from '../js/coin-sfx.js';
import { chimeScore } from '../js/coin-gain-pure.js';

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

test('renderChime builds exactly the score: notes × partials oscillators, one click, everything routed to the destination', () => {
  for (const amount of [20, 150, 800]) {
    const score = chimeScore(amount);
    const { ctx, log } = fakeAudio();
    const dest = { name: 'dest' };
    const end = renderChime(ctx, dest, 1.0, score);
    assert.equal(log.osc.length, score.notes.length * score.partials.length);
    assert.equal(log.sources.length, 1, 'one noise click');
    assert.equal(log.filters.length, 1);
    assert.ok(Math.abs(end - (1.0 + score.end)) < 1e-9);
    assert.equal(log.gains[0].out, dest, 'master gain feeds the destination');
    for (const o of log.osc) {
      assert.equal(o.type, 'sine');
      assert.ok(o.t0 >= 1.0, 'never scheduled before the start time');
      assert.ok(o.t1 > o.t0, 'every oscillator is stopped (no leak)');
      assert.ok(o.t1 <= end + 0.1);
    }
  }
});

test('every note envelope starts silent, peaks below full scale and ends silent (no clicks / no hanging tone)', () => {
  const { ctx, log } = fakeAudio();
  renderChime(ctx, {}, 0, chimeScore(800));
  const envelopes = log.gains.slice(1).filter((g) => g.gain.calls.length === 3); // note envelopes (the click has 2)
  assert.ok(envelopes.length >= 12);
  for (const g of envelopes) {
    const [[, v0], [, peak], [, v1]] = g.gain.calls;
    assert.ok(v0 < 0.001, 'starts at ~0');
    assert.ok(peak > 0 && peak <= 0.5, `peak ${peak}`);
    assert.ok(v1 < 0.001, 'ends at ~0');
  }
});

test('the click noise is deterministic (an offline render is repeatable)', () => {
  const a = fakeAudio(); renderChime(a.ctx, {}, 0, chimeScore(20));
  const b = fakeAudio(); renderChime(b.ctx, {}, 0, chimeScore(20));
  assert.deepEqual(Array.from(a.log.buffers[0].getChannelData(0).slice(0, 64)), Array.from(b.log.buffers[0].getChannelData(0).slice(0, 64)));
});
