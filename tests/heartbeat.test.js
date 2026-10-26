import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBeat, createHeartbeat, BEAT_MS, IDLE_MS } from '../js/heartbeat.js';

const base = { authed: true, hidden: false, now: 1_000_000, lastInput: 1_000_000, lastBeat: null };

test('shouldBeat: needs login, a visible tab and recent input', () => {
  assert.equal(shouldBeat(base), true);
  assert.equal(shouldBeat({ ...base, authed: false }), false);
  assert.equal(shouldBeat({ ...base, hidden: true }), false);
  assert.equal(shouldBeat({ ...base, lastInput: base.now - IDLE_MS - 1 }), false);
  assert.equal(shouldBeat({ ...base, lastInput: base.now - IDLE_MS + 1 }), true);
});

test('shouldBeat: never faster than one beat per interval', () => {
  assert.equal(shouldBeat({ ...base, lastBeat: base.now - 5000 }), false);
  assert.equal(shouldBeat({ ...base, lastBeat: base.now - BEAT_MS }), true);
});

function fakeEnv() {
  let t = 5_000_000;
  const listeners = {};
  const doc = { hidden: false, addEventListener: (e, f) => { listeners[`d:${e}`] = f; }, removeEventListener: (e) => { delete listeners[`d:${e}`]; } };
  const win = { addEventListener: (e, f) => { listeners[`w:${e}`] = f; }, removeEventListener: (e) => { delete listeners[`w:${e}`]; } };
  let tickFn = null;
  return {
    doc, win, listeners,
    now: () => t,
    advance: (ms) => { t += ms; },
    setIntervalFn: (fn) => { tickFn = fn; return 1; },
    clearIntervalFn: () => { tickFn = null; },
    fire: () => tickFn && tickFn(),
  };
}

test('createHeartbeat: beats on start, then on each interval; pauses when hidden or idle', async () => {
  const env = fakeEnv();
  let sent = 0;
  let authed = true;
  const hb = createHeartbeat({ isAuthed: () => authed, send: async () => { sent += 1; }, ...env });
  hb.start();
  await Promise.resolve();
  assert.equal(sent, 1, 'immediate beat on start');

  env.advance(BEAT_MS); await env.fire();
  assert.equal(sent, 2);

  env.doc.hidden = true;
  env.advance(BEAT_MS); await env.fire();
  assert.equal(sent, 2, 'hidden tab: no beat');

  env.doc.hidden = false;
  env.advance(IDLE_MS + 1000); await env.fire();
  assert.equal(sent, 2, 'idle for >5min: no beat');

  env.listeners['w:pointerdown'](); // user comes back
  await Promise.resolve(); await Promise.resolve();
  assert.equal(sent, 3, 'first input after idle beats right away');

  authed = false;
  env.advance(BEAT_MS); await env.fire();
  assert.equal(sent, 3, 'logged out: no beat');

  hb.stop();
  assert.equal(hb._state().running, false);
  assert.equal(Object.keys(env.listeners).length, 0, 'listeners removed');
});

test('createHeartbeat: a failing request never throws and does not block the next beat', async () => {
  const env = fakeEnv();
  let calls = 0;
  const hb = createHeartbeat({ isAuthed: () => true, send: async () => { calls += 1; throw new Error('offline'); }, ...env });
  hb.start();
  await Promise.resolve(); await Promise.resolve();
  env.advance(BEAT_MS); await env.fire();
  await Promise.resolve();
  assert.equal(calls, 2);
  hb.stop();
});
