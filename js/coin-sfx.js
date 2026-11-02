/**
 * 韭币到账音效 + 触感。
 *
 * The sound is a recorded clip (assets/sfx/coin-gain.mp3: coins poured into a bag, ~1.8 s, faded out at the end),
 * decoded once into a WebAudio buffer so the tap-to-sound delay stays tiny on phones.
 *
 * Browsers only let an AudioContext make sound after the visitor has touched the page once. We therefore create and
 * resume the context on the first tap / key press anywhere (installAudioUnlock), and playCoinSound() never starts the
 * clip on a context that is not running — a sound that arrives late, after an unlock, would be worse than silence.
 * If the clip is missing or cannot be decoded the game simply stays silent. The Android app's WebView allows autoplay.
 * There is deliberately no settings switch (yet).
 */
import { coinSoundVolume } from './coin-gain-pure.js';

const SAMPLE_URL = 'assets/sfx/coin-gain.mp3?v=20261102a';
/** A play request older than this when the audio finally becomes ready is dropped (silence beats a late sound). */
const FRESH_MS = 700;

let ctx = null;
let unlockInstalled = false;
const sample = { promise: null, buffer: null };
let current = null; // the clip that is playing now: { src, gain }

function AudioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function ensureContext() {
  if (ctx) return ctx;
  const C = AudioCtor();
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Fetch + decode the clip once. Resolves to the buffer, or null when it cannot be had (a later play retries). */
function loadSample(c) {
  if (sample.buffer) return Promise.resolve(sample.buffer);
  if (sample.promise) return sample.promise;
  sample.promise = Promise.resolve()
    .then(() => fetch(SAMPLE_URL))
    .then((r) => {
      if (!r || !r.ok) throw new Error('coin sound unavailable');
      return r.arrayBuffer();
    })
    .then(
      (bytes) =>
        new Promise((resolve, reject) => {
          // older Safari only has the callback form; newer browsers return a promise as well
          const p = c.decodeAudioData(bytes, resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        })
    )
    .then((buf) => {
      sample.buffer = buf;
      return buf;
    })
    .catch(() => {
      sample.promise = null;
      return null;
    });
  return sample.promise;
}

/** Start downloading + decoding the clip in the background (the context may still be suspended: that is fine). */
export function preloadCoinSound() {
  const c = ensureContext();
  if (c) loadSample(c);
}

function startClip(c, buffer, amount) {
  try {
    if (current) {
      // two gains never stack into a roar: the earlier clip fades out as the new one begins
      const t = c.currentTime;
      current.gain.gain.setValueAtTime(current.gain.gain.value, t);
      current.gain.gain.linearRampToValueAtTime(0, t + 0.06);
      current.src.stop(t + 0.08);
    }
  } catch {
    /* already ended */
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = coinSoundVolume(amount);
  src.connect(gain);
  gain.connect(c.destination);
  const mine = { src, gain };
  current = mine;
  src.onended = () => {
    if (current === mine) current = null;
  };
  src.start(c.currentTime + 0.01);
}

/** Create + resume the context inside the first user gesture (and keep trying until it is running). */
export function installAudioUnlock(target) {
  if (unlockInstalled || typeof document === 'undefined') return;
  const root = target || document;
  const events = ['pointerdown', 'touchend', 'mousedown', 'keydown'];
  const unlock = () => {
    const c = ensureContext();
    if (!c) {
      done();
      return;
    }
    const finish = () => {
      if (c.state === 'running') done();
    };
    try {
      const p = c.resume();
      if (p && typeof p.then === 'function') p.then(finish, () => {});
      // iOS: playing one silent sample inside the gesture fully unlocks output
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
    finish();
  };
  const done = () => {
    for (const e of events) root.removeEventListener(e, unlock, true);
  };
  for (const e of events) root.addEventListener(e, unlock, { capture: true, passive: true });
  unlockInstalled = true;
}

/** Play the coin sound for a gain of `amount`. @returns {boolean} true when it started right now. */
export function playCoinSound(amount) {
  const c = ensureContext();
  if (!c) return false;
  if (c.state === 'running' && sample.buffer) {
    startClip(c, sample.buffer, amount);
    return true;
  }
  // not ready yet (still unlocking and/or still decoding): start it if everything is ready soon enough
  const asked = typeof performance !== 'undefined' ? performance.now() : 0;
  const ready = [loadSample(c)];
  if (c.state !== 'running') {
    try {
      const p = c.resume();
      if (p && typeof p.then === 'function') ready.push(p.catch(() => {}));
    } catch {
      /* ignore */
    }
  }
  Promise.all(ready).then(([buf]) => {
    const fresh = typeof performance === 'undefined' || performance.now() - asked < FRESH_MS;
    if (buf && fresh && c.state === 'running') startClip(c, buf, amount);
  });
  return false;
}

/** One light tick (Android / Chrome; iOS Safari has no vibration API — a no-op there). */
export function hapticCoin() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(14);
  } catch {
    /* no haptics */
  }
}

/** Everything the player feels when 韭币 lands: the coin sound and the tick. */
export function playGainFeedback(amount) {
  playCoinSound(amount);
  hapticCoin();
}

/** Test hook: forget the context and the decoded clip. */
export function __resetCoinSfxForTests() {
  ctx = null;
  unlockInstalled = false;
  sample.promise = null;
  sample.buffer = null;
  current = null;
}
