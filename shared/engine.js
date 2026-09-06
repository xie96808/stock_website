/**
 * Shared sim30-mtm engine — pure functions, no DOM/window/network.
 * Works in browser (ESM + globalThis.StockSimEngine) and Node tests.
 */
import {
  RULE_VERSION,
  GAME_DAYS,
  DECISION_DAYS,
  INITIAL_CASH,
  FILL_MODES,
  ACTIONS,
  RULE_META,
} from './rules.js';

export {
  RULE_VERSION,
  GAME_DAYS,
  DECISION_DAYS,
  INITIAL_CASH,
  FILL_MODES,
  ACTIONS,
  RULE_META,
};

const ACTION_SET = new Set(ACTIONS);
const FILL_SET = new Set(FILL_MODES);

/** Round half away from zero (banker's not used): 1.5→2, -1.5→-2. */
export function roundHalfUp(x) {
  if (!Number.isFinite(x)) return NaN;
  if (x >= 0) return Math.floor(x + 0.5);
  return -Math.floor(-x + 0.5);
}

/** Display percent string from ppm: return_ppm / 10000 with 2 decimals. */
export function formatReturnPct(returnPpm) {
  if (!Number.isFinite(returnPpm)) return 'NaN';
  return (returnPpm / 10000).toFixed(2);
}

function fail(code, message, extra) {
  const err = { ok: false, code, message, ruleVersion: RULE_VERSION };
  if (extra) Object.assign(err, extra);
  return err;
}

function isValidBar(bar) {
  if (!bar || typeof bar !== 'object') return false;
  const { open, high, low, close } = bar;
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return false;
  if (high < Math.max(open, close) || low > Math.min(open, close)) return false;
  if (high < low) return false;
  return true;
}

/**
 * Validate + replay decision actions against a 30-day OHLC window.
 *
 * @param {object} opts
 * @param {'next_open'|'same_close'} opts.fillMode
 * @param {Array<{open:number,high:number,low:number,close:number}>} opts.bars length 30
 * @param {Array<'buy'|'sell'|'hold'>} opts.actions length 1..29 (29 required if finish)
 * @param {boolean} [opts.finish=false] apply day-30 valuation settle
 * @returns {object} ok result or {ok:false,code,message}
 */
export function replayGame(opts = {}) {
  const fillMode = opts.fillMode;
  const bars = opts.bars;
  const actions = opts.actions;
  const finish = !!opts.finish;

  if (!FILL_SET.has(fillMode)) {
    return fail(422, 'invalid fillMode', { fillMode });
  }
  if (!Array.isArray(bars) || bars.length !== GAME_DAYS) {
    return fail(422, `bars must have length ${GAME_DAYS}`, { got: bars && bars.length });
  }
  for (let i = 0; i < bars.length; i++) {
    if (!isValidBar(bars[i])) {
      return fail(422, `invalid OHLC at day ${i + 1}`, { day: i + 1 });
    }
  }
  if (!Array.isArray(actions)) {
    return fail(422, 'actions must be an array');
  }
  if (actions.length < 1 || actions.length > DECISION_DAYS) {
    return fail(422, `actions length must be 1..${DECISION_DAYS}`, { got: actions.length });
  }
  if (finish && actions.length !== DECISION_DAYS) {
    return fail(422, `finish requires exactly ${DECISION_DAYS} actions`, { got: actions.length });
  }

  let position = 'empty'; // empty | holding | locked
  let buyFillDay = null;
  let buyPrice = null;
  let M = 1;
  const trades = [];
  let holdingDays = 0;

  for (let i = 0; i < actions.length; i++) {
    const decisionDay = i + 1;
    const action = actions[i];
    if (!ACTION_SET.has(action)) {
      return fail(422, `illegal action enum at day ${decisionDay}`, { day: decisionDay, action });
    }

    // Calendar advance unlocks yesterday's T+1 lock before today's order.
    if (position === 'locked') {
      position = 'holding';
    }

    let fillDay;
    let fillPrice;
    if (fillMode === 'same_close') {
      fillDay = decisionDay;
      fillPrice = bars[decisionDay - 1].close;
    } else {
      fillDay = decisionDay + 1;
      fillPrice = bars[fillDay - 1].open;
    }

    if (action === 'buy') {
      if (position !== 'empty') {
        return fail(422, 'buy while not flat', { day: decisionDay, position });
      }
      position = 'locked';
      buyFillDay = fillDay;
      buyPrice = fillPrice;
      trades.push({ type: 'buy', day: fillDay, price: fillPrice });
    } else if (action === 'sell') {
      if (position === 'empty') {
        return fail(422, 'sell while flat', { day: decisionDay });
      }
      if (buyFillDay == null || !(buyPrice > 0)) {
        return fail(422, 'sell without open lot', { day: decisionDay });
      }
      // T+1: sell fill day must be strictly greater than buy fill day.
      if (fillDay <= buyFillDay) {
        return fail(422, 'T+1 violation: sell fill day must be > buy fill day', {
          day: decisionDay,
          buyFillDay,
          sellFillDay: fillDay,
        });
      }
      const multiple = fillPrice / buyPrice;
      M *= multiple;
      trades.push({ type: 'sell', day: fillDay, price: fillPrice, return: multiple });
      position = 'empty';
      buyFillDay = null;
      buyPrice = null;
    }
    // hold: no fill

    if (position === 'holding' || position === 'locked') {
      const skipFillDayRecount =
        fillMode === 'next_open' &&
        buyFillDay != null &&
        decisionDay === buyFillDay;
      if (!skipFillDayRecount) holdingDays += 1;
    }
  }

  let valuation = null;
  let equityMultiple = M;

  if (finish) {
    if (position === 'locked') position = 'holding';
    if (position === 'holding' && buyPrice > 0 && buyFillDay != null) {
      const day30close = bars[GAME_DAYS - 1].close;
      const skipFillDayRecount =
        fillMode === 'next_open' && buyFillDay === GAME_DAYS;
      if (!skipFillDayRecount) holdingDays += 1;

      const multiple = day30close / buyPrice;
      valuation = {
        day: GAME_DAYS,
        price: day30close,
        buyDay: buyFillDay,
        buyPrice,
        multiple,
        kind: 'valuation',
      };
      equityMultiple = M * multiple;
      // Position remains conceptually long for classification, but settled.
    }
  } else if (position === 'holding' || position === 'locked') {
    // Mark-to-market at last revealed close (decisionDay == actions.length).
    const asOfDay = actions.length; // 1..29 bar index asOfDay-1; when length 29, day 29 close shown before finish
    const markClose = bars[asOfDay - 1].close;
    equityMultiple = M * (markClose / buyPrice);
  }

  const returnRatio = equityMultiple - 1;
  const returnPpm = roundHalfUp(returnRatio * 1e6);
  const returnPct = formatReturnPct(returnPpm);
  const tradeGains = trades
    .filter((t) => t.type === 'sell' && t.return != null)
    .map((t) => (t.return - 1) * 100);

  // After finish with valuation, expose settled flat for UI cash, keep valuation object.
  let uiPosition = position;
  if (finish) {
    uiPosition = 'empty';
  }

  return {
    ok: true,
    ruleVersion: RULE_VERSION,
    fillMode,
    finish,
    trades,
    valuation,
    tradeCount: trades.length,
    equityMultiple,
    returnRatio,
    returnPpm,
    returnPct,
    position: uiPosition,
    rawPosition: position,
    buyFillDay: finish ? null : buyFillDay,
    buyPrice: finish ? 0 : buyPrice || 0,
    costBasis: finish ? 0 : buyPrice || 0,
    holdingDays,
    tradeGains,
    initialCash: INITIAL_CASH,
    closedMultiple: M,
  };
}

/** Convenience: full finished game (29 actions + day-30 settle). */
export function settleGame(opts) {
  return replayGame({ ...opts, finish: true });
}

export const StockSimEngine = {
  RULE_VERSION,
  GAME_DAYS,
  DECISION_DAYS,
  INITIAL_CASH,
  FILL_MODES,
  ACTIONS,
  RULE_META,
  roundHalfUp,
  formatReturnPct,
  replayGame,
  settleGame,
};

if (typeof globalThis !== 'undefined') {
  globalThis.StockSimEngine = StockSimEngine;
}

export default StockSimEngine;
