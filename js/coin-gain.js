/**
 * 韭币到账弹窗 — the one 「获得韭币」 card used wherever 韭币 is earned (docs/coin-gain.md).
 *
 *   showCoinGain({ amount, source, sub?, balance?, key? }) → Promise (resolves when this card is dismissed)
 *
 * - One card per gain, shown strictly one after another, on top of everything (z-index above toasts and dialogs).
 * - The coin in the middle is a hand-drawn vector coin with a real rim that spins continuously (CSS 3D), with a
 *   breathing halo, a sweeping shine and four twinkling stars. prefers-reduced-motion: it holds still.
 * - Opening plays the coin-shower sound (金钱哗啦啦) and a light haptic tick (coin-sfx.js).
 * - Dismissing sends a handful of small coins flying to the balance in the top bar, which bumps as they land.
 * Pure decisions (copy, queue, timings, sound score) live in coin-gain-pure.js.
 */
import {
  GAIN_TITLE,
  normalizeGain,
  countUpMs,
  flyCoinCount,
  easeOutCubic,
  createGainQueue,
} from './coin-gain-pure.js';
import { installAudioUnlock, playGainFeedback } from './coin-sfx.js';
import { coinIconHtml } from './icon-art.js';
import { coinAmountHtml, escapeHtml } from './unit-icons.js';

/** The coin face, traced from the drawn 韭币 art (assets/lucky-wheel/lw-prize-1) so the hero coin is the same coin. */
const GLYPH_PATH =
  'M46.8 25.7Q44.6 25.9 41.8 27.0Q39.0 28.0 37.2 29.0Q35.5 30.1 33.6 31.8Q31.7 33.5 30.4 35.3Q29.0 37.1 28.0 39.1Q27.0 41.2 26.4 43.1Q25.9 44.9 25.7 47.9Q25.4 50.9 25.7 53.1Q25.9 55.3 26.9 57.9Q27.8 60.5 28.9 62.5Q30.1 64.5 31.8 66.3Q33.4 68.1 35.2 69.5Q37.0 70.8 40.9 73.0Q44.9 75.1 50.5 75.2Q56.1 75.2 56.9 74.7Q57.8 74.2 58.6 74.1Q59.5 74.1 61.7 72.9Q63.9 71.8 65.8 70.1Q67.7 68.4 68.0 67.4Q68.3 66.4 70.2 63.6Q72.0 60.8 72.9 58.4Q73.8 56.0 74.1 53.4Q74.5 50.8 74.2 47.7Q74.0 44.6 73.0 42.0Q72.1 39.3 71.0 37.4Q69.8 35.5 68.2 33.7Q66.6 31.9 64.8 30.5Q63.1 29.2 61.0 28.1Q58.8 27.0 56.9 26.5Q55.1 25.9 52.1 25.7Q49.1 25.4 46.8 25.7ZM45.6 59.7Q47.1 58.3 47.5 58.3Q47.9 58.3 48.1 58.8Q48.4 59.2 49.1 63.5Q49.7 67.8 49.6 68.3Q49.5 68.9 49.0 69.1Q48.5 69.4 47.0 69.0Q45.4 68.7 44.7 67.9Q44.1 67.2 43.7 65.9Q43.4 64.7 43.4 63.8Q43.4 62.9 43.8 62.0Q44.1 61.0 45.6 59.7ZM43.4 37.7Q44.6 37.1 45.1 37.7Q45.5 38.4 46.3 44.8Q47.1 51.2 44.8 52.9Q42.4 54.6 41.3 55.7Q40.2 56.9 39.2 58.5Q38.3 60.1 38.0 61.9Q37.7 63.6 37.3 64.0Q37.0 64.3 36.1 63.5Q35.2 62.8 34.2 61.4Q33.2 60.0 32.1 57.4Q31.0 54.9 30.7 53.1Q30.5 51.3 30.7 48.3Q30.9 45.3 32.0 42.9Q33.1 40.5 33.4 40.5Q33.6 40.6 34.4 41.8Q35.1 42.9 36.2 43.2Q37.4 43.4 38.1 42.9Q38.8 42.4 40.5 40.4Q42.2 38.4 43.4 37.7ZM51.5 36.0Q51.9 35.7 52.8 36.0Q53.7 36.3 54.9 37.2Q56.0 38.1 56.5 38.8Q56.9 39.5 57.2 40.6Q57.4 41.7 57.1 43.4Q56.7 45.2 55.2 46.7Q53.7 48.2 53.1 47.9Q52.6 47.7 51.8 42.6Q51.0 37.5 51.0 36.9Q51.1 36.3 51.5 36.0ZM61.1 34.6Q61.3 34.3 63.0 35.7Q64.7 37.1 66.4 39.7Q68.0 42.4 68.7 45.1Q69.4 47.9 69.3 50.8Q69.2 53.6 68.1 56.6Q67.0 59.6 65.7 61.4Q64.4 63.1 62.2 65.0Q59.9 66.8 58.7 67.4Q57.4 68.1 56.8 68.2Q56.1 68.2 55.6 67.7Q55.2 67.1 54.5 61.4Q53.7 55.7 54.1 55.1Q54.5 54.5 57.0 52.6Q59.5 50.8 60.5 49.5Q61.4 48.3 62.0 47.1Q62.6 45.8 62.8 44.7Q63.1 43.6 63.0 41.9Q63.0 40.2 61.9 37.5Q60.9 34.8 61.1 34.6Z';

const FACE_SVG =
  '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<circle cx="50" cy="50" r="49.5" fill="#3a3530"/>' +
  '<circle cx="50" cy="50" r="45.6" fill="#cdd3bb"/>' +
  '<circle cx="50" cy="50" r="43" fill="none" stroke="#e9eddc" stroke-width="1.8"/>' +
  '<circle cx="50" cy="50" r="34.3" fill="none" stroke="#1b6b3a" stroke-width="6.8"/>' +
  `<path d="${GLYPH_PATH}" fill="#1b6b3a" fill-rule="evenodd"/>` +
  '</svg>';

const RIM_LAYERS = 7; // thin discs stacked between the two faces: the coin's milled edge when it turns edge-on

function coin3dHtml() {
  let rim = '';
  for (let i = 0; i < RIM_LAYERS; i++) {
    const z = i - (RIM_LAYERS - 1) / 2; // -3 … +3 px
    rim += `<i class="cg-rim" style="--z:${z}px"></i>`;
  }
  return (
    '<div class="cg-coin3d" aria-hidden="true">' +
    rim +
    `<span class="cg-face cg-face--front">${FACE_SVG}</span>` +
    `<span class="cg-face cg-face--back">${FACE_SVG}</span>` +
    '</div>'
  );
}

const ART_BASE = 'assets/lucky-wheel/';
const ART_V = '20261019w';
const CARD_ART = ['lw-result-card@2x.webp', 'lw-go-default@2x.webp', 'lw-go-press@2x.webp'];

/** The card frame and button art are the lucky wheel's; fetch them once, early and quietly, so the first card never pops in bare. */
export function warmCoinGainArt() {
  if (typeof Image === 'undefined') return;
  for (const f of CARD_ART) {
    const i = new Image();
    i.decoding = 'async';
    i.src = `${ART_BASE}${f}?v=${ART_V}`;
  }
}

const queue = createGainQueue();
let busy = false;
let activeOverlay = null;
let activeCleanup = null;

function prefersReduced() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Fire-and-forget safe: bad input resolves immediately and shows nothing. */
export function showCoinGain(input) {
  const gain = normalizeGain(input);
  if (!gain) return Promise.resolve();
  return new Promise((resolve) => {
    if (!queue.push({ ...gain, resolve })) {
      resolve();
      return;
    }
    pump();
  });
}

function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  present(next);
}

function present(gain) {
  const prevFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'cg-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cgTitle');
  const bal =
    gain.balance != null ? `<div class="cg-bal">当前余额 ${coinAmountHtml(gain.balance, { size: 14 })}</div>` : '';
  overlay.innerHTML =
    `<div class="cg-wrap"><div class="cg-card">` +
    `<h3 class="cg-title" id="cgTitle">${GAIN_TITLE}</h3>` +
    `<div class="cg-disc"><i class="cg-halo"></i>` +
    `<b class="cg-star cg-star--1"></b><b class="cg-star cg-star--2"></b><b class="cg-star cg-star--3"></b><b class="cg-star cg-star--4"></b>` +
    `<div class="cg-stage">${coin3dHtml()}</div></div>` +
    `<div class="cg-amount"><span class="cg-plus">+</span><span class="cg-num" data-to="${gain.amount}">${gain.amount}</span>` +
    `<span class="cg-unit">${coinIconHtml({ size: 24 })}<span class="u-sr">韭币</span></span></div>` +
    `<div class="cg-sub">${escapeHtml(gain.sub)}</div>` +
    bal +
    `<div class="cg-actions"><button type="button" class="cg-ok" id="cgOk">好的</button></div>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  const openedAt = performance.now();
  let closing = false;

  const ok = overlay.querySelector('#cgOk');
  for (const ev of ['pointerdown']) ok.addEventListener(ev, () => (ok.dataset.state = 'press'));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ok.addEventListener(ev, () => (ok.dataset.state = 'default'));

  const close = () => {
    if (closing) return;
    // swallow the tap that caused the gain (ghost click) — nobody can read the card in 350 ms anyway
    if (performance.now() - openedAt < 350) return;
    closing = true;
    document.removeEventListener('keydown', onKey, true);
    const coinRect = overlay.querySelector('.cg-stage')?.getBoundingClientRect();
    overlay.classList.remove('is-open');
    overlay.classList.add('is-leaving');
    flyCoinsToBalance(coinRect, gain.amount);
    window.setTimeout(() => {
      if (overlay._cgUnfit) overlay._cgUnfit();
      overlay.remove();
      if (activeOverlay === overlay) activeOverlay = null;
      try {
        if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
      busy = false;
      gain.resolve();
      // the next card waits until the previous coins are mostly home
      window.setTimeout(pump, prefersReduced() ? 0 : 280);
    }, prefersReduced() ? 120 : 200);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  ok.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('cg-wrap')) close();
  });
  document.addEventListener('keydown', onKey, true);
  activeCleanup = () => {
    document.removeEventListener('keydown', onKey, true);
  };

  const fit = () => fitWrap(overlay);
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  overlay._cgUnfit = () => {
    window.removeEventListener('resize', fit);
    window.removeEventListener('orientationchange', fit);
  };
  void overlay.offsetWidth;
  overlay.classList.add('is-open');
  const reduced = prefersReduced();
  if (!reduced) countUp(overlay.querySelector('.cg-num'), gain.amount, () => !overlay.isConnected);
  playGainFeedback(gain.amount);
  window.setTimeout(() => {
    try {
      ok.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, 60);
}

/** The card (with the ribbon hanging above it) must always fit the viewport: scale it down on short screens, never up. */
function fitWrap(overlay) {
  const wrap = overlay.querySelector('.cg-wrap');
  const card = overlay.querySelector('.cg-card');
  if (!wrap || !card) return;
  wrap.style.transform = '';
  const need = card.offsetHeight + 74 /* ribbon overhang */ + 34 /* wrap margin-top */ + 24;
  const have = window.innerHeight || document.documentElement.clientHeight || need;
  const s = Math.max(0.55, Math.min(1, have / need));
  wrap.style.transform = s < 1 ? `scale(${s.toFixed(3)})` : '';
}

function countUp(node, to, gone) {
  if (!node || !Number.isFinite(to) || to <= 0) return;
  const dur = countUpMs(to);
  const t0 = performance.now();
  const step = (now) => {
    if (gone() || !node.isConnected) return;
    const u = Math.min(1, (now - t0) / dur);
    node.textContent = String(Math.round(to * easeOutCubic(u)));
    if (u < 1) requestAnimationFrame(step);
    else node.textContent = String(to);
  };
  node.textContent = '0';
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ coins fly to the balance in the top bar */

function balanceTarget() {
  const el = document.getElementById('jiuCoinBalanceVal');
  const box = el && el.closest('.jiu-coin-balance');
  const chrome = document.getElementById('jiuCoinChrome');
  const visible = (n) => {
    if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight ? r : null;
  };
  const r = (chrome && chrome.hidden ? null : visible(box)) || null;
  if (!r) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: box };
}

function bump(el) {
  if (!el) return;
  el.classList.remove('cg-bump');
  void el.offsetWidth;
  el.classList.add('cg-bump');
  window.setTimeout(() => el.classList.remove('cg-bump'), 420);
}

function flyCoinsToBalance(fromRect, amount) {
  if (!fromRect || prefersReduced()) return;
  const target = balanceTarget();
  const n = flyCoinCount(amount);
  const layer = document.createElement('div');
  layer.className = 'cg-fly-layer';
  document.body.appendChild(layer);
  const sx = fromRect.left + fromRect.width / 2;
  const sy = fromRect.top + fromRect.height / 2;
  // no balance chip on this screen: the coins rise and fade where the card was (nothing is left hanging)
  const tx = target ? target.x : sx;
  const ty = target ? target.y : sy - 120;
  let landed = 0;
  const done = () => {
    landed += 1;
    if (target) bump(target.el);
    if (landed >= n) window.setTimeout(() => layer.remove(), 60);
  };
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'cg-fly-coin';
    c.innerHTML = coinIconHtml({ size: 20 });
    layer.appendChild(c);
    const a = (Math.PI * 2 * i) / n + 0.6;
    const burst = 26 + (i % 3) * 10;
    const bx = sx + Math.cos(a) * burst;
    const by = sy + Math.sin(a) * burst * 0.7 - 10;
    // pull the arc to one side so the coins sweep instead of travelling in a line
    const mx = (bx + tx) / 2 + (ty - by) * 0.18;
    const my = (by + ty) / 2 - Math.abs(tx - bx) * 0.12;
    const dur = 560 + (i % 4) * 70;
    const delay = i * 48;
    const half = (v) => `translate(${v[0] - 10}px, ${v[1] - 10}px)`;
    const anim = c.animate(
      [
        { transform: `${half([sx, sy])} scale(.5)`, opacity: 0, offset: 0 },
        { transform: `${half([bx, by])} scale(1.05)`, opacity: 1, offset: 0.22, easing: 'cubic-bezier(.3,0,.2,1)' },
        { transform: `${half([mx, my])} scale(.9)`, opacity: 1, offset: 0.6 },
        { transform: `${half([tx, ty])} scale(.55)`, opacity: 0.9, offset: 1 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'both' }
    );
    anim.onfinish = () => {
      c.remove();
      done();
    };
    anim.oncancel = () => c.remove();
  }
  if (!target) window.setTimeout(() => layer.remove(), 900 + n * 50);
}

/** Wire the audio unlock and warm the card art. Safe to call more than once. */
export function initCoinGain() {
  installAudioUnlock();
  const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 1200));
  idle(() => warmCoinGainArt());
}

/** Test hook: drop everything on screen and forget queued cards. */
export function __resetCoinGainForTests() {
  queue.clear();
  busy = false;
  if (activeCleanup) activeCleanup();
  activeCleanup = null;
  if (activeOverlay && activeOverlay._cgUnfit) activeOverlay._cgUnfit();
  if (activeOverlay) activeOverlay.remove();
  activeOverlay = null;
  document.querySelectorAll('.cg-overlay,.cg-fly-layer').forEach((n) => n.remove());
}
