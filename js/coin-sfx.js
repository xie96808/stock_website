/**
 * 韭币到账音效 + 触感。
 *
 * 「金钱哗啦啦」is synthesised with WebAudio (no audio file, 0 bytes of assets) from the score in coin-gain-pure.js:
 * a swell of metallic rustle plus a few dozen tiny coin clinks that start dense and thin out; bigger gains pour longer.
 *
 * Browsers only let an AudioContext make sound after the visitor has touched the page once. We therefore create and
 * resume the context on the first tap / key press anywhere (installAudioUnlock), and playCoinSound() never schedules a
 * note on a context that is not running — a sound that arrives late, after an unlock, would be worse than silence.
 * The Android app's WebView allows autoplay, so it is not affected. There is deliberately no settings switch.
 */
import { showerScore } from './coin-gain-pure.js';

let ctx = null;
let unlockInstalled = false;

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

/**
 * Schedule one coin shower on any BaseAudioContext (live or Offline) — also used by the tests / the preview render.
 * @returns {number} the time (s) at which the sound has faded out
 */
export function renderShower(audio, destination, startAt, score) {
  const master = audio.createGain();
  master.gain.value = score.master;
  master.connect(destination);

  // one shared noise bed: the rustle ("哗") and every clink's tiny clack read slices of it
  const sr = audio.sampleRate;
  const frames = Math.max(1, Math.floor(sr * (score.end + 0.2)));
  const bed = audio.createBuffer(1, frames, sr);
  const data = bed.getChannelData(0);
  let seed = 12345; // deterministic, so an offline render is repeatable
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }

  // the rustle: a band of noise that swells, holds and trails off while the coins pour
  {
    const r = score.rustle;
    const src = audio.createBufferSource();
    src.buffer = bed;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = r.freq;
    bp.Q.value = r.q;
    const g = audio.createGain();
    const t0 = startAt + r.at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(r.gain, t0 + r.attack);
    g.gain.setValueAtTime(r.gain, t0 + r.attack + r.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + r.attack + r.hold + r.release);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
  }

  // the clinks: each a small inharmonic bell plus a short clack
  let slice = 0.3;
  for (const c of score.clinks) {
    const t = startAt + c.at;
    for (const p of score.partials) {
      const len = c.ring * p.decay;
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = c.freq * p.ratio;
      const g = audio.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.gain * p.amp * 0.5), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.01);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + len + 0.04);
    }
    const src = audio.createBufferSource();
    src.buffer = bed;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, c.freq * 1.7);
    bp.Q.value = 1.4;
    const tg = audio.createGain();
    tg.gain.setValueAtTime(c.gain * 0.55, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
    src.connect(bp);
    bp.connect(tg);
    tg.connect(master);
    src.start(t, slice % Math.max(0.1, score.end));
    slice += 0.037;
  }

  return startAt + score.end;
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

/** Play the coin shower for a gain of `amount`. @returns {boolean} true when it was scheduled right now. */
export function playCoinSound(amount) {
  const c = ensureContext();
  if (!c) return false;
  const go = () => {
    try {
      renderShower(c, c.destination, c.currentTime + 0.02, showerScore(amount, Math.floor(Math.random() * 4294967296)));
    } catch {
      /* ignore */
    }
  };
  if (c.state === 'running') {
    go();
    return true;
  }
  const asked = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const p = c.resume();
    if (p && typeof p.then === 'function') {
      p.then(
        () => {
          const fresh = typeof performance === 'undefined' || performance.now() - asked < 700;
          if (c.state === 'running' && fresh) go();
        },
        () => {}
      );
    }
  } catch {
    /* ignore */
  }
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

/** Everything the player feels when 韭币 lands: the coin shower and the tick. */
export function playGainFeedback(amount) {
  playCoinSound(amount);
  hapticCoin();
}
