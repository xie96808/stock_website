/**
 * Daily close equity curve, MDD, and buy-hold benchmark (PRD §4.1 / B03).
 * Additive helper — does not change settleGame returnPpm semantics.
 *
 * next_open: day-t close equity includes only fills with fillDay <= t;
 * orders submitted on day t that fill next open do not affect day-t close.
 */
import {
  GAME_DAYS,
  DECISION_DAYS,
  INITIAL_CASH,
  FILL_MODES,
} from './rules.js';
import { roundHalfUp } from './engine.js';

export const SCORE_VERSION_CURVE_V1 = 'sim30-mtm-curve-v1';

const FILL_SET = new Set(FILL_MODES);

/**
 * @returns {number[]} cash equity E(0)..E(throughDay)
 */
export function buildEquityCurveCash({ fillMode, bars, actions, finish = false }) {
  if (!FILL_SET.has(fillMode)) {
    throw new Error(`invalid fillMode: ${fillMode}`);
  }
  if (!Array.isArray(bars) || bars.length !== GAME_DAYS) {
    throw new Error(`bars must have length ${GAME_DAYS}`);
  }
  const acts = Array.isArray(actions) ? actions : [];
  const throughDay = finish
    ? GAME_DAYS
    : Math.min(Math.max(acts.length + 1, 1), GAME_DAYS);

  let M = 1;
  let shares = 0;
  let entryPrice = 0;
  /** @type {null | { side: 'buy'|'sell', fillDay: number, price: number }} */
  let pending = null;

  const curve = [INITIAL_CASH];

  for (let t = 1; t <= throughDay; t++) {
    if (pending && pending.fillDay === t) {
      if (pending.side === 'buy') {
        shares = 1;
        entryPrice = pending.price;
      } else {
        M *= pending.price / entryPrice;
        shares = 0;
        entryPrice = 0;
      }
      pending = null;
    }

    if (t <= DECISION_DAYS && t <= acts.length) {
      const action = acts[t - 1];
      if (fillMode === 'same_close') {
        if (action === 'buy' && shares === 0) {
          shares = 1;
          entryPrice = bars[t - 1].close;
        } else if (action === 'sell' && shares === 1) {
          M *= bars[t - 1].close / entryPrice;
          shares = 0;
          entryPrice = 0;
        }
      } else if (action === 'buy' && shares === 0 && !pending) {
        // fill at next open; needs bars[t] (day t+1)
        if (t < GAME_DAYS) {
          pending = { side: 'buy', fillDay: t + 1, price: bars[t].open };
        }
      } else if (action === 'sell' && shares === 1 && !pending) {
        if (t < GAME_DAYS) {
          pending = { side: 'sell', fillDay: t + 1, price: bars[t].open };
        }
      }
    }

    let equity;
    if (shares === 1 && entryPrice > 0) {
      equity = INITIAL_CASH * M * (bars[t - 1].close / entryPrice);
    } else {
      equity = INITIAL_CASH * M;
    }
    curve.push(equity);
  }

  return curve;
}

/** MDD in ppm from cash curve including E(0). */
export function mddPpmFromCurve(equityCash) {
  if (!Array.isArray(equityCash) || equityCash.length === 0) return 0;
  let peak = equityCash[0];
  let maxDd = 0;
  for (const e of equityCash) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = 1 - e / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return roundHalfUp(maxDd * 1e6);
}

/**
 * Buy-hold with same fill convention:
 * next_open → buy day-2 open, value day-30 close;
 * same_close → buy day-1 close, value day-30 close.
 */
export function buyHoldBenchmarkPpm({ fillMode, bars }) {
  if (!FILL_SET.has(fillMode)) {
    throw new Error(`invalid fillMode: ${fillMode}`);
  }
  const buyPrice = fillMode === 'next_open' ? bars[1].open : bars[0].close;
  const sellPrice = bars[GAME_DAYS - 1].close;
  return roundHalfUp((sellPrice / buyPrice - 1) * 1e6);
}

/**
 * Full settle metrics for persistence / DTO.
 * @returns {{ mddPpm: number, benchmarkReturnPpm: number, equityCurve: Array<{day:number,equity:number}>, scoreVersion: string }}
 */
export function settleCurveMetrics({ fillMode, bars, actions }) {
  const cash = buildEquityCurveCash({ fillMode, bars, actions, finish: true });
  const equityCurve = cash.map((equity, day) => ({
    day,
    equity: roundHalfUp(equity),
  }));
  return {
    mddPpm: mddPpmFromCurve(cash),
    benchmarkReturnPpm: buyHoldBenchmarkPpm({ fillMode, bars }),
    equityCurve,
    scoreVersion: SCORE_VERSION_CURVE_V1,
  };
}

export function revealedGameDay(actionCount, gameDays = GAME_DAYS) {
  const n = Number.isFinite(actionCount) ? actionCount : 0;
  return Math.min(n + 1, gameDays);
}
