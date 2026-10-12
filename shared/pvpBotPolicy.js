/**
 * Pure bot decision policy for realtime PvP. Server and tests import this;
 * do not pull js/analysis-pure.js into the API package.
 */
import { actionAvailability, PVP_FILL_MODE } from './pvpMetrics.js';

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Null-padded simple moving average of close prices. */
export function smaNullPad(closes, period) {
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j];
    out.push(sum / period);
  }
  return out;
}

function legalActions(bars, priorActions) {
  const avail = actionAvailability({ fillMode: PVP_FILL_MODE, bars, actions: priorActions });
  const list = [];
  if (avail.canHold) list.push('hold');
  if (avail.canBuy) list.push('buy');
  if (avail.canSell) list.push('sell');
  return { avail, list };
}

function pickRandom(list, rng) {
  if (!list.length) return 'hold';
  const idx = Math.floor(clamp01(rng()) * list.length) % list.length;
  return list[idx];
}

/**
 * Prefer buy/sell from MA5/MA10 golden/death cross on revealed closes.
 * Falls back to soft trend, then hold.
 */
function preferFromMa(closes) {
  if (!closes.length) return 'hold';
  const ma5 = smaNullPad(closes, 5);
  const ma10 = smaNullPad(closes, 10);
  const i = closes.length - 1;
  const m5 = ma5[i];
  const m10 = ma10[i];
  if (m5 == null || m10 == null) return 'hold';
  const p5 = i > 0 ? ma5[i - 1] : null;
  const p10 = i > 0 ? ma10[i - 1] : null;
  if (p5 != null && p10 != null) {
    if (p5 <= p10 && m5 > m10) return 'buy';
    if (p5 >= p10 && m5 < m10) return 'sell';
  }
  if (m5 > m10) return 'buy';
  if (m5 < m10) return 'sell';
  return 'hold';
}

/**
 * @param {{ bars: object[], priorActions: string[], revealedBars?: number, tier?: string, rng?: () => number }} args
 * @returns {'buy'|'sell'|'hold'}
 */
export function decideAction({
  bars,
  priorActions = [],
  revealedBars = null,
  tier = 'normal',
  rng = Math.random,
} = {}) {
  const { avail, list } = legalActions(bars, priorActions);
  if (!list.length) return 'hold';

  if (tier === 'easy') return pickRandom(list, rng);

  const revealed = Number.isInteger(revealedBars) && revealedBars > 0
    ? Math.min(revealedBars, bars?.length || 0)
    : Math.min((priorActions?.length || 0) + 1, bars?.length || 0);
  const closes = Array.isArray(bars)
    ? bars.slice(0, Math.max(1, revealed)).map((bar) => Number(bar.close))
    : [];
  const prefer = preferFromMa(closes);

  // ~25% noise so play feels less deterministic on normal.
  if (clamp01(rng()) < 0.25) return pickRandom(list, rng);

  if (prefer === 'buy' && avail.canBuy) return 'buy';
  if (prefer === 'sell' && avail.canSell) return 'sell';
  if (avail.canHold) return 'hold';
  return list[0];
}

/**
 * Human-like delay inside a round. If the human already locked, answer faster.
 * @returns {number} delay ms from round open (or from now when humanLocked and caller uses now-based due)
 */
export function pickBotDelayMs({ dayMs = 30_000, humanLocked = false, rng = Math.random } = {}) {
  const day = Number.isInteger(dayMs) && dayMs > 0 ? dayMs : 30_000;
  if (humanLocked) {
    return 500 + Math.floor(clamp01(rng()) * 1500);
  }
  const min = 1500;
  const max = Math.max(min + 1, day - 2000);
  return min + Math.floor(clamp01(rng()) * (max - min));
}
