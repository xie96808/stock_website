/**
 * 韭币到账音效 + 触感。
 *
 * The chime is synthesised with WebAudio (no audio file, 0 bytes of assets) from the score in coin-gain-pure.js:
 * a metallic click and a rising two-note bell "叮—铃", with one or two sparkle notes on top for bigger gains.
 *
 * Browsers only let an AudioContext make sound after the visitor has touched the page once. We therefore create and
 * resume the context on the first tap / key press anywhere (installAudioUnlock), and playCoinChime() never schedules a
 * note on a context that is not running — a chime that arrives late, after an unlock, would be worse than silence.
 * The Android app's WebView allows autoplay, so it is not affected. There is deliberately no settings switch.
 */
import { chimeScore } from './coin-gain-pure.js';

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
 * Schedule one chime on any BaseAudioContext (live or Offline) — also used by the tests / the preview render.
 * @returns {number} the time (s) at which the last note has faded out
 */
export function renderChime(audio, destination, startAt, score) {
  const master = audio.createGain();
  master.gain.value = score.master;
  master.connect(destination);

  for (const note of score.notes) {
    for (const p of score.partials) {
      const len = note.ring * p.decay;
      const t = startAt + note.at;
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = note.freq * p.ratio;
      const g = audio.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, note.gain * p.amp * 0.5), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.02);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + len + 0.06);
    }
  }

  // the coin "click": a few ms of band-passed noise
  const tick = score.tick;
  const frames = Math.max(1, Math.floor(audio.sampleRate * (tick.ring + 0.01)));
  const buf = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 12345; // deterministic, so an offline render is repeatable
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  const bp = audio.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = tick.freq;
  bp.Q.value = 1.6;
  const tg = audio.createGain();
  const tt = startAt + tick.at;
  tg.gain.setValueAtTime(tick.gain, tt);
  tg.gain.exponentialRampToValueAtTime(0.0001, tt + tick.ring);
  src.connect(bp);
  bp.connect(tg);
  tg.connect(master);
  src.start(tt);

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

/** Play the chime for a gain of `amount`. @returns {boolean} true when it was scheduled right now. */
export function playCoinChime(amount) {
  const c = ensureContext();
  if (!c) return false;
  const go = () => {
    try {
      renderChime(c, c.destination, c.currentTime + 0.02, chimeScore(amount));
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

/** Everything the player feels when 韭币 lands: the chime and the tick. */
export function playGainFeedback(amount) {
  playCoinChime(amount);
  hapticCoin();
}
