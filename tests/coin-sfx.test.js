import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { playCoinSound, preloadCoinSound, __resetCoinSfxForTests } from '../js/coin-sfx.js';
import { coinSoundVolume } from '../js/coin-gain-pure.js';

/** A recording stand-in for AudioContext + fetch (node has neither). */
function setup({ state = 'running', fetchOk = true } = {}) {
  const log = { ctx: 0, fetches: [], decodes: 0, sources: [], gains: [], resumes: 0 };
  const param = (v = 1) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {} });
  class FakeCtx {
    constructor() { log.ctx++; this.state = state; this.currentTime = 5; this.destination = { name: 'dest' }; }
    resume() { log.resumes++; this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(bytes) { log.decodes++; return Promise.resolve({ duration: 1.8, tag: 'decoded' }); }
    createGain() { const g = { gain: param(), connect(n) { g.out = n; } }; log.gains.push(g); return g; }
    createBufferSource() { const s = { connect(n) { s.out = n; }, start(t) { s.t0 = t; }, stop(t) { s.t1 = t; } }; log.sources.push(s); return s; }
  }
  globalThis.window = { AudioContext: FakeCtx };
  globalThis.fetch = async (url) => { log.fetches.push(url); return { ok: fetchOk, arrayBuffer: async () => new ArrayBuffer(8) }; };
  __resetCoinSfxForTests();
  return log;
}
const settle = () => new Promise((r) => setTimeout(r, 15));

test('the recorded clip ships with the site, short and light', () => {
  const st = statSync(new URL('../assets/sfx/coin-gain.mp3', import.meta.url));
  assert.ok(st.size > 5_000 && st.size < 80_000, `${st.size} bytes`);
});

test('first play on a running context loads the clip, then starts it (routed to the speakers, volume by amount)', async () => {
  const log = setup();
  assert.equal(playCoinSound(150), false, 'the clip is not decoded yet: nothing starts synchronously');
  await settle();
  assert.equal(log.fetches.length, 1);
  assert.match(log.fetches[0], /assets\/sfx\/coin-gain\.mp3/);
  assert.equal(log.sources.length, 1, 'it still plays (the request was fresh)');
  assert.equal(log.sources[0].buffer.tag, 'decoded');
  assert.equal(log.sources[0].out, log.gains[0]);
  assert.equal(log.gains[0].out.name, 'dest');
  assert.equal(log.gains[0].gain.value, coinSoundVolume(150));
  assert.ok(log.sources[0].t0 > 5, 'scheduled just after now');
});

test('once decoded, later plays start at once; the clip is fetched and decoded only one time', async () => {
  const log = setup();
  preloadCoinSound();
  await settle();
  assert.equal(log.sources.length, 0, 'preload alone makes no sound');
  assert.equal(playCoinSound(20), true);
  assert.equal(playCoinSound(800), true);
  assert.equal(log.fetches.length, 1);
  assert.equal(log.decodes, 1);
  assert.equal(log.sources.length, 2);
  assert.ok(log.sources[0].t1 > 5, 'the earlier clip is faded out as the next begins (no stacking roar)');
});

test('a context that is still suspended is resumed; the sound plays only if it becomes running in time', async () => {
  const log = setup({ state: 'suspended' });
  preloadCoinSound();
  await settle();
  assert.equal(playCoinSound(20), false);
  await settle();
  assert.equal(log.resumes, 1);
  assert.equal(log.sources.length, 1);
});

test('a missing / broken clip stays silent and does not throw; a later play tries again', async () => {
  const log = setup({ fetchOk: false });
  assert.doesNotThrow(() => playCoinSound(20));
  await settle();
  assert.equal(log.sources.length, 0);
  playCoinSound(20);
  await settle();
  assert.equal(log.fetches.length, 2, 'retried');
});

test('no AudioContext at all (old browser): silently does nothing', () => {
  globalThis.window = {};
  __resetCoinSfxForTests();
  assert.equal(playCoinSound(20), false);
});
