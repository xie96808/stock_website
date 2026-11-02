/**
 * 结算页「遗憾值 + 炒股性格」— pure model + copy (no DOM, no network).
 *
 * Runs on the result screen from data the client already holds after settle (the 30-bar window and the 29 actions),
 * through the same engine the paid 最优路线重演 uses (shared/reviewEngine). Display-only: it changes no settlement,
 * ranking or reward, and it works for guests (the server review endpoint is registered-users only).
 */
import { buildReview } from '../shared/reviewEngine.js';
import { GAME_DAYS, DECISION_DAYS } from '../shared/rules.js';

/** Under this many percentage points of regret we say "几乎零遗憾". */
export const NEAR_ZERO_PTS = 0.5;
/** Share of the optimal return from which the player counts as 神仙盘感. */
export const GOD_CAPTURE_PCT = 80;
/** Buys from which the player counts as 手比脑子快. */
export const BUSY_BUYS = 5;
/** Below this return a "nothing special" game is 摸索中, not 稳扎稳打. */
export const STEADY_FLOOR_PCT = -3;

/**
 * Which game kinds get the card: classic and 韭币局 (开一局). A stake game plays the classic rules (30 days, no rewind,
 * no cap on buys), so the optimal route is the same one. Other modes have their own caps / rules, so "optimal" differs.
 */
const REGRET_KINDS = new Set(['classic', 'stake']);
export function regretEligible({ gameKind, maxOrders } = {}) {
  if (gameKind && !REGRET_KINDS.has(gameKind)) return false;
  if (maxOrders != null) return false;
  return true;
}

/** The 30-bar game window and 29 actions from the session, or null when they are not a full classic game. */
export function windowFromSession(view, actions) {
  if (!view || !Array.isArray(view.gameKline)) return null;
  const hist = Number(view.historyLength);
  if (!Number.isFinite(hist) || hist < 0) return null;
  const bars = view.gameKline.slice(hist, hist + GAME_DAYS);
  if (bars.length !== GAME_DAYS) return null;
  if (!Array.isArray(actions) || actions.length !== DECISION_DAYS) return null;
  return { bars, actions };
}

export const PERSONAS = Object.freeze({
  god: { key: 'god', name: '神仙盘感', line: '买卖点和最优解只差一口气。', tip: '挑战满分' },
  watcher: { key: 'watcher', name: '空仓观众', line: '只看不动，行情都替别人涨了。', tip: '这次试着出手' },
  nail: { key: 'nail', name: '钉子户', line: '买了就不看，拿到天荒地老。', tip: '试试在高点落袋' },
  chaser: { key: 'chaser', name: '追高侠', line: '总在最热闹的时候入场。', tip: '试试等回调再买' },
  cutter: { key: 'cutter', name: '割肉达人', line: '刚割完，它就涨回来了。', tip: '试试多扛一天' },
  flyer: { key: 'flyer', name: '卖飞选手', line: '刚卖出就涨，总是少拿一段。', tip: '试试让利润多跑一会' },
  busy: { key: 'busy', name: '手比脑子快', line: '出手越多，不等于机会越多。', tip: '试试只出手 2 次' },
  steady: { key: 'steady', name: '稳扎稳打', line: '不贪不急，节奏在线。', tip: '冲更高的分' },
  // Not one of the eight: a "nothing special" game that lost clearly would be mislabelled 稳扎稳打.
  explorer: { key: 'explorer', name: '摸索中', line: '还没找到节奏，下一局先盯准一个买点。', tip: '先盯准一个买点' },
  // Optimal was to stay out and the player did.
  wise: { key: 'wise', name: '稳扎稳打', line: '这段行情怎么买都亏，你选对了：空仓。', tip: '换个行情试试' },
});

/** First matching persona (see docs/diagrams: 8 types, first hit wins). */
export function pickPersona({ optPct, minePct, capturePct, buys, trips }) {
  const list = Array.isArray(trips) ? trips : [];
  const nothingToEarn = !(optPct > 0.005);
  if (!nothingToEarn && optPct > NEAR_ZERO_PTS && capturePct != null && capturePct >= GOD_CAPTURE_PCT) return PERSONAS.god;
  if (buys === 0) return nothingToEarn ? PERSONAS.wise : PERSONAS.watcher;
  if (buys === 1 && list.length === 1 && list[0].held) return PERSONAS.nail;
  const tagged = (tag) => list.filter((t) => Array.isArray(t.tags) && t.tags.includes(tag)).length;
  if (list.length && tagged('追高') * 2 >= list.length) return PERSONAS.chaser;
  if (tagged('割在底部') > 0) return PERSONAS.cutter;
  if (tagged('卖飞') > 0) return PERSONAS.flyer;
  if (buys >= BUSY_BUYS) return PERSONAS.busy;
  return minePct >= STEADY_FLOOR_PCT ? PERSONAS.steady : PERSONAS.explorer;
}

const LEAKS = Object.freeze({
  missed: { key: 'missed', label: '空仓错过' },
  stayed: { key: 'stayed', label: '该跑没跑' },
  spread: { key: 'spread', label: '进出场价差' },
});

/** The biggest of the three gaps as one short sentence, or null when none is big enough to name. */
export function pickLeak({ gap, buys }) {
  if (!gap) return null;
  const ranked = [
    ['missed', gap.missed],
    ['stayed', gap.stayed],
    ['spread', gap.spread],
  ].sort((a, b) => b[1] - a[1]);
  const [key, value] = ranked[0];
  if (!(value >= NEAR_ZERO_PTS)) return null;
  const label = LEAKS[key].label;
  let text;
  if (key === 'missed') {
    text = buys === 0
      ? '三十天一笔没下，最好的一波行情全在看戏。'
      : '最优操作在场的日子，你空仓在旁边看。';
  } else if (key === 'stayed') {
    text = '最优操作已经离场，你还拿着。';
  } else {
    text = '两边都在场，但你买得更贵或卖得更早。';
  }
  return { key, label, text };
}

const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const fmtSigned = (x) => `${x >= 0 ? '+' : '−'}${fmt1(Math.abs(x))}%`;

/**
 * Everything the card shows, or null (the card stays hidden) when this game is not eligible or the input is not a
 * complete window — the result screen must never break because of this card.
 *
 * state:
 *   'regret' — the optimal route beat the player by NEAR_ZERO_PTS or more
 *   'near'   — within NEAR_ZERO_PTS of optimal (几乎零遗憾)
 *   'none'   — no route made money in this window (最优 = 空仓不动)
 */
export function buildRegretModel({ fillMode, bars, actions, gameKind = null, maxOrders = null } = {}) {
  try {
    if (!regretEligible({ gameKind, maxOrders })) return null;
    if (!Array.isArray(bars) || bars.length !== GAME_DAYS) return null;
    if (!Array.isArray(actions) || actions.length !== DECISION_DAYS) return null;
    const review = buildReview({ fillMode, bars, actions });
    const optPct = review.optimal.returnPct;
    const minePct = review.mine.returnPct;
    const buys = review.mine.buys;
    const nothingToEarn = !(optPct > 0.005);
    const regretPts = nothingToEarn ? 0 : Math.max(0, optPct - minePct);
    const capturePct = nothingToEarn
      ? null
      : (minePct > 0 ? Math.max(0, Math.min(100, Math.round((minePct / optPct) * 100))) : 0);
    const state = nothingToEarn ? 'none' : (regretPts < NEAR_ZERO_PTS ? 'near' : 'regret');
    const persona = pickPersona({ optPct, minePct, capturePct, buys, trips: review.mine.trips });
    const leak = state === 'regret' ? pickLeak({ gap: review.gap, buys }) : null;
    return {
      state,
      optPct,
      minePct,
      regretPts: Math.round(regretPts * 10) / 10,
      capturePct,
      buys,
      leak,
      persona,
      again: againHint({ state, regretPts, persona }),
    };
  } catch (err) {
    // Display-only: a bad window must not take the result screen down.
    if (typeof console !== 'undefined') console.warn('[regret] skipped', err && err.message);
    return null;
  }
}

/** The small reason printed beside 「再来一局」. */
export function againHint({ state, regretPts, persona }) {
  if (state === 'regret' && regretPts >= 1) return `补回这 ${Math.round(regretPts)}%`;
  return (persona && persona.tip) || '';
}

/** Card copy for a model (the DOM layer only places these strings). */
export function regretCopy(model) {
  if (!model) return null;
  const { state } = model;
  if (state === 'none') {
    return {
      kicker: '这段行情',
      big: '空仓不动',
      bigTone: 'flat',
      meta: `最优操作：不买。你的结果 ${fmtSigned(model.minePct)}`,
      barLabel: null,
      explain: model.buys > 0 ? '怎么买都亏，出手就是在送钱。' : '',
    };
  }
  if (state === 'near') {
    return {
      kicker: '遗憾值',
      big: '几乎零遗憾',
      bigTone: 'good',
      meta: `最优 ${fmtSigned(model.optPct)} · 你 ${fmtSigned(model.minePct)}`,
      barLabel: `你拿到最优的 ${model.capturePct}%`,
      explain: '进出场都很准。',
    };
  }
  return {
    kicker: '遗憾值 · 最优操作多赚了',
    big: `+${fmt1(model.regretPts)}%`,
    bigTone: 'bad',
    meta: `最优 ${fmtSigned(model.optPct)} · 你 ${fmtSigned(model.minePct)}`,
    barLabel: `你拿到最优的 ${model.capturePct}%`,
    explain: model.leak ? `最大遗憾：${model.leak.label}。${model.leak.text}` : '',
  };
}

/** Fine print under the card: "最优" is hindsight, say so once. */
export const REGRET_FOOTNOTE = '最优 = 事后看全程能做到的最好，仅供复盘。';

/** Button reason for guests: 再来一局 needs an account. */
export function againHintForGuest(hint) {
  return hint ? `${hint} · 注册后继续` : '注册后继续';
}
