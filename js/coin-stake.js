/**
 * 韭币局 client glue: feature flag cache, the stake picker inside the start modal, last-used stake.
 * The picker lives in #fillModeChoosePane (index.html); start-flow.js shows it only for the stake kind.
 */
import { getAuthState } from './auth.js';
import {
  STAKE_MIN,
  STAKE_MAX,
  clampStake,
  clampToBalance,
  affordablePresets,
  stakeAffordable,
  stakePayoutRows,
  reelDigits,
} from './coin-stake-pure.js';

const LS_KEY = 'stockgame.stake';
let flag = null; // null = unknown
let flagPromise = null;
let bound = false;

export function primeStakeFlag(features) {
  if (features && typeof features === 'object') flag = !!features.coinStake;
}

/** Resolves to whether 韭币局 is live. Cached; a failed read counts as off (traditional flow stays usable). */
export function stakeEnabled() {
  if (flag != null) return Promise.resolve(flag);
  if (!flagPromise) {
    flagPromise = fetch('/api/v1/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        flag = !!j?.data?.features?.coinStake;
        return flag;
      })
      .catch(() => {
        flagPromise = null;
        return false;
      });
  }
  return flagPromise;
}

/** Sync read for places that cannot await (null until known). */
export function stakeEnabledSync() {
  return flag;
}

function loadLast() {
  try {
    const n = Number(localStorage.getItem(LS_KEY));
    return Number.isFinite(n) && n > 0 ? clampStake(n) : 50;
  } catch {
    return 50;
  }
}

function saveLast(n) {
  try {
    localStorage.setItem(LS_KEY, String(n));
  } catch { /* private mode */ }
}

const $ = (id) => document.getElementById(id);
let current = 50;

export function getStake() {
  return current;
}

function balance() {
  const u = getAuthState().user;
  const n = Number(u && u.jiuCoinBalance);
  return Number.isFinite(n) ? n : null;
}

/* ── slot reels ───────────────────────────────────────────────────
 * Three reels, each a strip of 40 digit cells (cell i shows i % 10). A reel rests on a cell in 10..19 so it can
 * always roll forward without running off the strip; after the roll it snaps back to the equivalent resting cell.
 */
const CELLS = 40;
const REST = 10;
const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
let reels = null; // [{el, strip, cell, timer}]

function buildReels() {
  const host = $('stakeReels');
  if (!host) return null;
  if (reels && reels[0].el.parentNode === host) return reels;
  host.innerHTML = '';
  reels = [0, 1, 2].map(() => {
    const el = document.createElement('span');
    el.className = 'stake-reel';
    const strip = document.createElement('span');
    strip.className = 'stake-reel-strip';
    for (let i = 0; i < CELLS; i++) {
      const c = document.createElement('span');
      c.className = 'stake-reel-cell';
      c.textContent = String(i % 10);
      strip.appendChild(c);
    }
    el.appendChild(strip);
    host.appendChild(el);
    const r = { el, strip, cell: REST, timer: 0 };
    place(r, REST, 0);
    return r;
  });
  return reels;
}

function place(r, cell, ms) {
  r.strip.style.transition = ms ? `transform ${ms}ms cubic-bezier(.17,.84,.3,1.04)` : 'none';
  r.strip.style.setProperty('--cell', String(cell));
  r.cell = cell;
}

function settle(r) {
  clearTimeout(r.timer);
  r.el.classList.remove('is-rolling');
  place(r, REST + (r.cell % 10), 0);
  void r.strip.offsetHeight; // commit the snap before the next roll
}

/** Roll reel `i` to `digit`. `turns` full extra revolutions make it look like a pull of the lever. */
function roll(i, digit, { spin, turns = 0, ms = 520 } = {}) {
  const r = reels[i];
  settle(r);
  const from = r.cell % 10;
  const delta = ((digit - from + 10) % 10) + 10 * turns;
  if (delta === 0) return;
  if (!spin || reducedMotion()) {
    place(r, REST + digit, 0);
    return;
  }
  r.el.classList.add('is-rolling');
  place(r, r.cell + delta, ms);
  r.timer = setTimeout(() => settle(r), ms + 80);
}

let shown = null; // digits currently on the reels (so a re-render only rolls what changed)
function paintReels({ spin = true, pull = false } = {}) {
  if (!buildReels()) return;
  const next = reelDigits(current);
  next.forEach((d, i) => {
    reels[i].el.classList.toggle('is-dim', d.dim);
    if (pull) roll(i, d.digit, { spin: true, turns: 1 + i, ms: 750 + i * 260 });
    else if (!shown || shown[i] !== d.digit) roll(i, d.digit, { spin, turns: 0, ms: 420 + i * 60 });
  });
  shown = next.map((d) => d.digit);
  const host = $('stakeReels');
  if (host) host.setAttribute('data-value', String(current));
}

let nextSpin = true;

function render() {
  const input = $('stakeInput');
  const range = $('stakeRange');
  const bal = balance();
  if (input && String(input.value) !== String(current) && document.activeElement !== input) input.value = String(current);
  if (range) range.value = String(Math.round(current / 10) * 10);
  const balEl = $('stakeBalance');
  if (balEl) balEl.textContent = bal == null ? '' : `余额 ${bal}`;
  const ok = stakeAffordable(current, bal);
  paintReels({ spin: nextSpin });
  const rows = $('stakePayoutRows');
  const preview = $('stakePreview');
  const panel = $('stakePayout');
  if (panel) panel.classList.toggle('is-warn', !ok);
  if (rows) {
    rows.hidden = !ok;
    rows.innerHTML = ok
      ? stakePayoutRows(current)
          .map((r) => `<div class="stake-payout-row is-${r.tone}"><span>${r.label}</span><b>${r.value}</b><i>韭币</i></div>`)
          .join('')
      : '';
  }
  if (preview) {
    preview.hidden = ok;
    preview.textContent = ok ? '' : `韭币不够，余额 ${bal}，最少要 ${STAKE_MIN}`;
    preview.classList.toggle('is-warn', !ok);
  }
  const confirm = $('fillModeConfirmBtn');
  const label = confirm && confirm.querySelector('.ctl-label');
  if (label && $('stakePicker') && !$('stakePicker').hidden) {
    label.textContent = ok ? `下注 ${current}` : '韭币不足';
    confirm.disabled = !ok;
  }
  const presets = $('stakePresets');
  if (presets) {
    for (const b of presets.querySelectorAll('button')) {
      b.classList.toggle('is-on', Number(b.dataset.v) === current);
    }
  }
}

function set(n, { persist = true } = {}) {
  current = clampStake(n);
  if (persist) saveLast(current);
  render();
}

function bind() {
  if (bound) return;
  bound = true;
  $('stakeMinus')?.addEventListener('click', () => set(current - 10));
  $('stakePlus')?.addEventListener('click', () => set(current + 10));
  $('stakeRange')?.addEventListener('input', (e) => {
    nextSpin = false; // dragging: follow the thumb instantly, no spinning
    set(Number(e.target.value));
    nextSpin = true;
  });
  const input = $('stakeInput');
  input?.addEventListener('input', () => {
    const n = Number(input.value);
    if (Number.isFinite(n) && n >= 1) {
      current = Math.min(STAKE_MAX, Math.max(1, Math.round(n)));
      nextSpin = false;
      render();
      nextSpin = true;
    }
  });
  input?.addEventListener('change', () => {
    set(Number(input.value));
    input.value = String(current);
  });
  $('stakePresets')?.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-v]');
    if (b) set(Number(b.dataset.v));
  });
}

/** Show/hide the picker and the fill-mode wording that goes with it. Called by start-flow on open. */
export function mountStakePicker(on) {
  const picker = $('stakePicker');
  if (!picker) return;
  picker.hidden = !on;
  $('fillModeModal')?.classList.toggle('is-stake', !!on); // casino skin for the dialog (css/coin-stake.css)
  const sub = $('fillModeSub');
  if (sub) {
    sub.hidden = !!on; // the picker explains itself; saves a screen's worth of height on phones
    sub.textContent = '选定成交方式后开始加载；默认仍是次日开盘';
  }
  const note = $('playModeGuestNote');
  if (note) note.hidden = !!on;
  if (!on) {
    const confirm = $('fillModeConfirmBtn');
    const label = confirm && confirm.querySelector('.ctl-label');
    if (label) label.textContent = '开始游戏';
    if (confirm) confirm.disabled = false;
    return;
  }
  bind();
  const presets = $('stakePresets');
  if (presets) {
    presets.innerHTML = '';
    const list = affordablePresets(balance());
    presets.style.setProperty('--n', String(list.length)); // one row, however many chips
    for (const v of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stake-preset';
      b.dataset.v = String(v);
      b.textContent = String(v);
      presets.appendChild(b);
    }
  }
  const bal = balance();
  current = clampStake(bal == null ? loadLast() : clampToBalance(loadLast(), bal));
  shown = null;
  buildReels();
  // Opening the sheet = pulling the lever: every reel starts blank-ish at 0 and rolls up to the stake.
  nextSpin = false;
  render(); // fills balance / payout / confirm label; reels jump straight to the stake
  nextSpin = true;
  reels.forEach((r) => { clearTimeout(r.timer); place(r, REST, 0); });
  void $('stakeReels').offsetHeight;
  paintReels({ pull: true });
}

/** Re-sync after a balance change while the picker is open. */
export function refreshStakePicker() {
  const picker = $('stakePicker');
  if (picker && !picker.hidden) render();
}
