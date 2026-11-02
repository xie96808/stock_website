/**
 * 结算页「遗憾值 + 炒股性格」卡片 — DOM layer. All decisions and copy live in regret-pure.js.
 * Called by result.js endGame(); it must never throw into the result screen (the caller isolates it too).
 */
import { getSession, selectSettleView } from './game-session.js';
import { selectIsGuest, getAuthState } from './auth.js';
import {
  buildRegretModel,
  windowFromSession,
  regretCopy,
  REGRET_FOOTNOTE,
  againHintForGuest,
} from './regret-pure.js';

const $ = (id) => document.getElementById(id);

let runToken = 0;
let rafId = 0;
let observer = null;

function reducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text == null ? '' : String(text);
}

function stopAnimation() {
  runToken += 1;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (observer) {
    try { observer.disconnect(); } catch { /* ignore */ }
    observer = null;
  }
}

/** Put the 再来一局 reason next to the button label (or clear it). */
export function setAgainHint(text) {
  const el = $('resultAgainHint');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

export function hideRegretCard() {
  stopAnimation();
  const el = $('resultRegret');
  if (el) el.hidden = true;
  setAgainHint('');
}

/** Is at least `ratio` of the element inside the viewport right now? */
function visibleRatio(el) {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const seen = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  return Math.max(0, seen) / r.height;
}

/**
 * Bar 0 → capture% with an overshoot, and the red number counting up beside it.
 * It always starts shortly after the result appears, so the number is never left waiting at 0 with the
 * "最优 … · 你 …" line already telling a different story. A bar that is still below the fold on a small phone is
 * replayed once when it scrolls into view, so the fill is seen either way.
 */
function runAnimation(model, copy) {
  const bar = $('rgBar');
  const fill = $('rgFill');
  const big = $('rgBig');
  if (!bar || !fill) return;
  const pct = model.capturePct == null ? 0 : model.capturePct;
  fill.style.setProperty('--rg-w', `${pct}%`);
  bar.classList.remove('is-run', 'is-static');
  if (reducedMotion()) {
    bar.classList.add('is-static');
    return;
  }
  const countUp = model.state === 'regret' && big;
  const token = ++runToken;
  const replayBar = () => {
    bar.classList.remove('is-run');
    void bar.offsetWidth; // restart the CSS animation
    bar.classList.add('is-run');
  };
  const start = () => {
    if (token !== runToken) return;
    const barSeen = visibleRatio(bar) >= 0.35;
    replayBar();
    if (!barSeen && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        if (token !== runToken) return;
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.35)) {
          try { observer.disconnect(); } catch { /* ignore */ }
          observer = null;
          replayBar();
        }
      }, { threshold: [0.35] });
      observer.observe(bar);
    }
    if (!countUp) return;
    const target = model.regretPts;
    const t0 = performance.now();
    const dur = 1000;
    const tick = (now) => {
      if (token !== runToken) return;
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      big.textContent = k >= 1 ? copy.big : `+${(target * eased).toFixed(1)}%`;
      if (k < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };
  // Brief "pop-in" at 0, then go. (Timer, not visibility: the final number is on screen within ~1.6s no matter what.)
  if (countUp) big.textContent = '+0.0%';
  window.setTimeout(start, 600);
}

export function paintRegretCard() {
  stopAnimation();
  const root = $('resultRegret');
  if (!root) return null;
  const view = selectSettleView();
  const session = getSession();
  const win = windowFromSession(view, session.actions);
  const model = win
    ? buildRegretModel({
      fillMode: view.fillMode,
      bars: win.bars,
      actions: win.actions,
      gameKind: view.gameKind,
      maxOrders: view.maxOrders,
    })
    : null;
  if (!model) {
    hideRegretCard();
    return null;
  }
  const copy = regretCopy(model);
  root.dataset.state = model.state;
  root.dataset.tone = copy.bigTone;
  setText('rgKicker', copy.kicker);
  setText('rgBig', copy.big);
  setText('rgMeta', copy.meta);
  setText('rgBarLabel', copy.barLabel || '');
  setText('rgExplain', copy.explain || '');
  setText('rgPersonaName', model.persona.name);
  setText('rgPersonaLine', model.persona.line);
  setText('rgPersonaTip', model.persona.tip ? `下一局试试：${model.persona.tip}` : '');
  setText('rgFoot', REGRET_FOOTNOTE);
  const bar = $('rgBar');
  const showBar = model.capturePct != null;
  if (bar) bar.hidden = !showBar;
  const label = $('rgBarLabel');
  if (label) label.hidden = !showBar;
  const explain = $('rgExplain');
  if (explain) explain.hidden = !copy.explain;
  root.hidden = false;

  let hint = model.again;
  try {
    if (selectIsGuest(getAuthState())) hint = againHintForGuest(hint);
  } catch { /* guest wording is cosmetic */ }
  setAgainHint(hint);

  if (showBar) runAnimation(model, copy);
  return model;
}
