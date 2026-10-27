// ========== 最优路线重演 — pure state machine + copy (no DOM / fetch) ==========
// The replay walks the same 30-day window day by day. The player cannot trade: the optimal route's orders execute by
// themselves, and the walk pauses on every decision day that has an optimal order so the popup can explain it.
// `route` is the server's `review.route` (steps: { day, action, fillDay, price, reasons, tripIndex }).

export const REPLAY_DAYS = 30;

export function stepOnDay(route, day) {
  return (route || []).find((s) => s.day === day) || null;
}

export function initialReplay() {
  return { cur: 0, pos: 'flat', entry: null, fills: [], log: [], pause: null, done: false };
}

function applyFill(state, step, day) {
  const fill = { type: step.action, day, price: step.price };
  const fills = [...state.fills, fill];
  if (step.action === 'buy') {
    return { ...state, fills, pos: 'long', entry: step.price, log: [...state.log, { day, text: `第 ${day} 天 买入成交 ${step.price.toFixed(2)}` }] };
  }
  const gain = state.entry ? (step.price / state.entry - 1) * 100 : 0;
  return {
    ...state,
    fills,
    pos: 'flat',
    entry: null,
    log: [...state.log, { day, text: `第 ${day} 天 卖出成交 ${step.price.toFixed(2)}（这一笔 ${gain >= 0 ? '+' : ''}${gain.toFixed(2)}%）` }],
  };
}

/**
 * Move to the next day. Returns the same state while a popup is waiting or after the end.
 * next_open: fills from yesterday's decision land on arrival (at today's open); then today's decision may pause.
 * same_close: the fill lands when the popup is acknowledged (at today's close).
 */
export function advance(route, fillMode, state) {
  if (state.pause || state.done) return state;
  const day = state.cur + 1;
  let s = { ...state, cur: day };
  if (fillMode !== 'same_close') {
    for (const st of (route || []).filter((x) => x.fillDay === day)) s = applyFill(s, st, day);
  }
  if (day >= REPLAY_DAYS) return { ...s, done: true };
  const decision = stepOnDay(route, day);
  if (decision) return { ...s, pause: decision };
  return s;
}

/** Close the popup. same_close orders execute now. */
export function acknowledge(route, fillMode, state) {
  if (!state.pause) return state;
  let s = { ...state, pause: null };
  if (fillMode === 'same_close') s = applyFill(s, state.pause, state.cur);
  return s;
}

/** Walk to the end in one go (skip) — popups are not shown but every fill is applied. */
export function runToEnd(route, fillMode, state) {
  let s = state;
  for (let guard = 0; guard < 100 && !s.done; guard++) {
    s = advance(route, fillMode, s);
    if (s.pause) s = acknowledge(route, fillMode, s);
  }
  return s;
}

const sg = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

/** Running return (%) at the close of `day` for a 31-point multiple curve; day 0 / out of range → 0. */
export function curvePct(curve, day) {
  if (!Array.isArray(curve) || day < 0) return 0;
  const m = curve[Math.min(day, curve.length - 1)];
  return Number.isFinite(m) ? (m - 1) * 100 : 0;
}

export function fmtPct(x) {
  return Number.isFinite(x) ? sg(x) : '--';
}

/** Popup copy for a pause. */
export function popupCopy(step, fillMode) {
  const buy = step.action === 'buy';
  const when = fillMode === 'same_close' ? '今天收盘' : '明天开盘';
  const verb = buy ? '买入' : '卖出';
  return {
    kicker: `第 ${step.day} 天 · 最优${buy ? '买点' : '卖点'}`,
    title: `这天该${verb}`,
    sub: `${when}${verb}，成交价约 ${step.price.toFixed(2)}`,
    reasons: step.reasons || [],
    tone: buy ? 'buy' : 'sell',
    button: buy ? '好，买入' : '好，卖出',
  };
}

/** What each of the three gap sources means, for the summary bars. */
export const GAP_LABELS = Object.freeze([
  { key: 'missed', label: '空仓错过', hint: '最优在场、你不在场' },
  { key: 'stayed', label: '该跑没跑', hint: '最优已离场、你还拿着' },
  { key: 'spread', label: '进出场价差', hint: '都在场，但买贵了或卖早了' },
]);

/** Rows for the summary bars: positive = points lost to that source. Sources that gained a little are omitted. */
export function gapRows(gap) {
  if (!gap) return [];
  const rows = GAP_LABELS.map((g) => ({ ...g, value: Number(gap[g.key]) || 0 }));
  const max = Math.max(0.01, ...rows.map((r) => Math.max(0, r.value)));
  return rows.filter((r) => r.value > 0.04).map((r) => ({ ...r, width: Math.round((r.value / max) * 100) }));
}

/** SVG polyline points for the mini equity chart, revealed up to `day`. Y range is shared by all curves. */
export function curvePoints(curve, day, { width, height, pad = 6, yMin, yMax }) {
  if (!Array.isArray(curve) || day < 0) return '';
  const n = Math.min(day, curve.length - 1);
  const span = Math.max(1e-9, yMax - yMin);
  const pts = [];
  for (let d = 0; d <= n; d++) {
    const x = pad + (d / (REPLAY_DAYS)) * (width - pad * 2);
    const y = pad + (1 - (curve[d] - yMin) / span) * (height - pad * 2);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Shared y range over every curve that is shown (fixed for the whole replay so lines never rescale). */
export function curveRange(curves) {
  let lo = 1;
  let hi = 1;
  for (const c of curves) {
    if (!Array.isArray(c)) continue;
    for (const v of c) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const pad = Math.max(0.005, (hi - lo) * 0.08);
  return { yMin: lo - pad, yMax: hi + pad };
}

/** Teaser line for the result-page card. */
export function teaserCopy(teaser) {
  if (!teaser) return '';
  const opt = fmtPct(teaser.optimalReturnPct);
  if (teaser.optimalReturnPct <= 0.005) return '这一局怎么操作都赚不到钱，最优做法是空仓不动。想看看为什么？';
  if (teaser.capturePct != null) return `这局最优操作能赚 ${opt}，你拿到了 ${teaser.capturePct}%。`;
  return `这局最优操作能赚 ${opt}，你的结果是 ${fmtPct(teaser.yourReturnPct)}。`;
}

/** Buy button for a review product. `armed` = first tap done. */
export function reviewAction(product, balance, armed = false) {
  if (!product) return { kind: 'none', label: '', disabled: true };
  if (product.owned) return { kind: 'owned', label: '已解锁', disabled: true };
  if (!product.buyable) return { kind: 'locked', label: '先解锁路线重演', disabled: true };
  if ((Number(balance) || 0) < product.price) return { kind: 'poor', label: `还差 ${product.price - (Number(balance) || 0)}`, disabled: true };
  return armed
    ? { kind: 'confirm', label: `确认 -${product.price}`, disabled: false }
    : { kind: 'buy', label: `解锁 ${product.price}`, disabled: false };
}

export function reviewErrorToast(err) {
  switch (err && err.code) {
    case 'INSUFFICIENT_FUNDS': return '韭币不足';
    case 'ALREADY_UNLOCKED': return '这局已经解锁过了';
    case 'NEED_ROUTE': return '先解锁最优路线重演';
    case 'REVIEW_NOT_YET': return '每日挑战结束后（次日 0 点）才能复盘';
    case 'REVIEW_UNSUPPORTED': return '这个玩法暂不支持复盘';
    case 'NOT_SETTLED': return '对局还没保存成功，稍后再试';
    case 'FEATURE_DISABLED': return '复盘暂未开放';
    default: return '操作失败，请稍后再试';
  }
}
