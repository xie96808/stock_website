/**
 * puzzle-mtm-v1 — short-window single-symbol puzzles (PRD §4.3 / F02).
 * Additive to classic sim30-mtm-v1; does not change classic golden fixtures.
 *
 * Empty/full position ops, fixed next_open. Last day = terminal valuation only.
 * Returns / MDD measured vs takeover NAV (open mark on day 1).
 */
import { roundHalfUp, formatReturnPct } from './engine.js';

export const PUZZLE_RULE_VERSION = 'puzzle-mtm-v1';
export const PUZZLE_FILL_MODE = 'next_open';
export const PUZZLE_ACTIONS = Object.freeze(['buy', 'sell', 'hold']);
export const PUZZLE_MIN_DAYS = 6;
export const PUZZLE_MAX_DAYS = 10;

const ACTION_SET = new Set(PUZZLE_ACTIONS);

function fail(code, message, extra) {
  const err = { ok: false, code, message, ruleVersion: PUZZLE_RULE_VERSION };
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
 * @typedef {object} PuzzleInitialState
 * @property {number} cash
 * @property {number} qty  0 = flat; >0 = full long (empty/full ops)
 * @property {number} cost  per-share cost when qty>0; 0 when flat
 * @property {number|null} buyFillDay  fill day of open lot (may be <=0 for pre-window)
 * @property {number} firstSellableDay  first decision day allowed to place a sell (fill day > buyFillDay)
 */

/**
 * Normalize / validate authored initial state against bars.
 * Takeover mark = day-1 open (next_open chapter convention).
 */
export function normalizeInitialState(raw, bars) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 422, message: 'initialState required' };
  }
  const cash = Number(raw.cash);
  const qty = Number(raw.qty);
  const cost = Number(raw.cost);
  const buyFillDay = raw.buyFillDay == null ? null : Number(raw.buyFillDay);
  const firstSellableDay = Number(raw.firstSellableDay);
  if (!Number.isFinite(cash) || cash < 0) {
    return { ok: false, code: 422, message: 'invalid cash' };
  }
  if (!Number.isFinite(qty) || qty < 0) {
    return { ok: false, code: 422, message: 'invalid qty' };
  }
  if (qty === 0) {
    if (cash <= 0) return { ok: false, code: 422, message: 'flat requires positive cash' };
    if (cost !== 0 && Number.isFinite(cost) && cost !== 0) {
      /* allow cost 0 only when flat */
    }
    if (cost !== 0) return { ok: false, code: 422, message: 'flat cost must be 0' };
    if (buyFillDay != null) return { ok: false, code: 422, message: 'flat buyFillDay must be null' };
    if (!Number.isFinite(firstSellableDay) || firstSellableDay < 1) {
      return { ok: false, code: 422, message: 'invalid firstSellableDay' };
    }
  } else {
    if (!Number.isFinite(cost) || !(cost > 0)) {
      return { ok: false, code: 422, message: 'holding requires positive cost' };
    }
    if (cash !== 0) {
      return { ok: false, code: 422, message: 'full position requires cash 0 (empty/full ops)' };
    }
    if (buyFillDay != null && !Number.isFinite(buyFillDay)) {
      return { ok: false, code: 422, message: 'invalid buyFillDay' };
    }
    if (!Number.isFinite(firstSellableDay) || firstSellableDay < 1) {
      return { ok: false, code: 422, message: 'invalid firstSellableDay' };
    }
    // T+1 consistency: first sellable decision must produce fillDay > buyFillDay
    // next_open fillDay = decisionDay + 1
    if (buyFillDay != null && firstSellableDay + 1 <= buyFillDay) {
      return {
        ok: false,
        code: 422,
        message: 'firstSellableDay inconsistent with T+1 vs buyFillDay',
      };
    }
  }
  const takeoverMark = bars[0].open;
  const takeoverNav = cash + qty * takeoverMark;
  if (!(takeoverNav > 0)) {
    return { ok: false, code: 422, message: 'takeover NAV must be positive' };
  }
  const bookValue = cash + qty * (qty > 0 ? cost : 0);
  return {
    ok: true,
    state: {
      cash,
      qty,
      cost: qty > 0 ? cost : 0,
      buyFillDay: qty > 0 ? buyFillDay : null,
      firstSellableDay,
    },
    takeoverMark,
    takeoverNav,
    bookValue,
  };
}

/**
 * Replay a puzzle decision sequence.
 *
 * @param {object} opts
 * @param {'next_open'} [opts.fillMode]
 * @param {Array} opts.bars length gameDays (6..10)
 * @param {Array<'buy'|'sell'|'hold'>} opts.actions
 * @param {boolean} [opts.finish]
 * @param {PuzzleInitialState} opts.initialState
 * @param {number|null} [opts.maxOrders] max buy+sell fills; null = unlimited
 */
export function replayPuzzle(opts = {}) {
  const fillMode = opts.fillMode || PUZZLE_FILL_MODE;
  if (fillMode !== 'next_open') {
    return fail(422, 'puzzle fillMode must be next_open', { fillMode });
  }
  const bars = opts.bars;
  const actions = opts.actions;
  const finish = !!opts.finish;
  const maxOrders = opts.maxOrders == null ? null : Number(opts.maxOrders);

  if (!Array.isArray(bars) || bars.length < PUZZLE_MIN_DAYS || bars.length > PUZZLE_MAX_DAYS) {
    return fail(422, `bars length must be ${PUZZLE_MIN_DAYS}..${PUZZLE_MAX_DAYS}`, {
      got: bars && bars.length,
    });
  }
  const gameDays = bars.length;
  const decisionDays = gameDays - 1;
  for (let i = 0; i < bars.length; i++) {
    if (!isValidBar(bars[i])) {
      return fail(422, `invalid OHLC at day ${i + 1}`, { day: i + 1 });
    }
  }
  if (!Array.isArray(actions)) {
    return fail(422, 'actions must be an array');
  }
  if (actions.length < 1 || actions.length > decisionDays) {
    return fail(422, `actions length must be 1..${decisionDays}`, { got: actions.length });
  }
  if (finish && actions.length !== decisionDays) {
    return fail(422, `finish requires exactly ${decisionDays} actions`, { got: actions.length });
  }
  if (maxOrders != null && (!Number.isInteger(maxOrders) || maxOrders < 0)) {
    return fail(422, 'maxOrders must be a non-negative integer');
  }

  const init = normalizeInitialState(opts.initialState, bars);
  if (!init.ok) return fail(init.code || 422, init.message);

  let cash = init.state.cash;
  let qty = init.state.qty;
  let cost = init.state.cost;
  let buyFillDay = init.state.buyFillDay;
  const takeoverNav = init.takeoverNav;
  const trades = [];
  let orderCount = 0;

  // Snapshot for rejection-without-mutate (order budget).
  const snap = () => ({ cash, qty, cost, buyFillDay, orderCount, trades: trades.slice() });
  let preAction = snap();

  for (let i = 0; i < actions.length; i++) {
    const decisionDay = i + 1;
    const action = actions[i];
    preAction = snap();

    if (!ACTION_SET.has(action)) {
      return fail(422, `illegal action enum at day ${decisionDay}`, { day: decisionDay, action });
    }

    const fillDay = decisionDay + 1;
    if (fillDay > gameDays) {
      return fail(422, 'fill day beyond window', { day: decisionDay, fillDay, gameDays });
    }
    const fillPrice = bars[fillDay - 1].open;

    if (action === 'hold') {
      continue;
    }

    if (maxOrders != null && orderCount + 1 > maxOrders) {
      // Reject without mutating — restore pre-action snapshot explicitly.
      cash = preAction.cash;
      qty = preAction.qty;
      cost = preAction.cost;
      buyFillDay = preAction.buyFillDay;
      orderCount = preAction.orderCount;
      trades.length = 0;
      for (const t of preAction.trades) trades.push(t);
      return fail(422, 'order budget exceeded', {
        day: decisionDay,
        maxOrders,
        orderCount,
        action,
        rejected: true,
        stateUnchanged: true,
      });
    }

    if (action === 'buy') {
      if (qty > 0 || cash <= 0) {
        return fail(422, 'buy while not flat', { day: decisionDay, qty, cash });
      }
      qty = cash / fillPrice;
      cost = fillPrice;
      cash = 0;
      buyFillDay = fillDay;
      orderCount += 1;
      trades.push({ type: 'buy', day: fillDay, price: fillPrice });
    } else if (action === 'sell') {
      if (!(qty > 0)) {
        return fail(422, 'sell while flat', { day: decisionDay });
      }
      if (decisionDay < init.state.firstSellableDay) {
        return fail(422, 'sell before firstSellableDay', {
          day: decisionDay,
          firstSellableDay: init.state.firstSellableDay,
        });
      }
      if (buyFillDay != null && fillDay <= buyFillDay) {
        return fail(422, 'T+1 violation: sell fill day must be > buy fill day', {
          day: decisionDay,
          buyFillDay,
          sellFillDay: fillDay,
        });
      }
      cash = qty * fillPrice;
      const multiple = fillPrice / cost;
      trades.push({ type: 'sell', day: fillDay, price: fillPrice, return: multiple });
      qty = 0;
      cost = 0;
      buyFillDay = null;
      orderCount += 1;
    }
  }

  /** Equity at close of day t (1-based). Pending next_open fills not yet applied. */
  function equityAtClose(day) {
    const mark = bars[day - 1].close;
    return cash + qty * mark;
  }

  let finalEquity;
  let valuation = null;
  if (finish) {
    // Terminal valuation at last close; no decision on last day.
    finalEquity = equityAtClose(gameDays);
    if (qty > 0) {
      valuation = {
        day: gameDays,
        price: bars[gameDays - 1].close,
        buyDay: buyFillDay,
        buyPrice: cost,
        kind: 'valuation',
      };
    }
  } else {
    const asOf = actions.length; // last revealed decision day close
    finalEquity = equityAtClose(asOf);
  }

  const returnRatio = finalEquity / takeoverNav - 1;
  const returnPpm = roundHalfUp(returnRatio * 1e6);

  // Equity curve for MDD vs takeover peak (cash curve including E0=takeoverNav).
  const curveDays = finish ? gameDays : Math.min(actions.length, gameDays);
  const equityCash = [takeoverNav];
  // Rebuild path day by day for MDD (re-sim with same actions is expensive; use closes after fills).
  // Accurate curve: re-run fill timing.
  {
    let c = init.state.cash;
    let q = init.state.qty;
    let cst = init.state.cost;
    let bfd = init.state.buyFillDay;
    /** @type {null|{side:string,fillDay:number,price:number}} */
    let pending = null;
    for (let t = 1; t <= curveDays; t++) {
      if (pending && pending.fillDay === t) {
        if (pending.side === 'buy') {
          q = c / pending.price;
          cst = pending.price;
          c = 0;
          bfd = t;
        } else {
          c = q * pending.price;
          q = 0;
          cst = 0;
          bfd = null;
        }
        pending = null;
      }
      if (t <= actions.length && t <= decisionDays) {
        const a = actions[t - 1];
        if (a === 'buy' && q === 0 && !pending && t < gameDays) {
          pending = { side: 'buy', fillDay: t + 1, price: bars[t].open };
        } else if (a === 'sell' && q > 0 && !pending && t < gameDays) {
          pending = { side: 'sell', fillDay: t + 1, price: bars[t].open };
        }
      }
      equityCash.push(c + q * bars[t - 1].close);
    }
  }

  let peak = equityCash[0];
  let maxDd = 0;
  for (const e of equityCash) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = 1 - e / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  const mddPpm = roundHalfUp(maxDd * 1e6);

  return {
    ok: true,
    ruleVersion: PUZZLE_RULE_VERSION,
    fillMode,
    finish,
    gameDays,
    decisionDays,
    trades,
    tradeCount: trades.length,
    orderCount,
    valuation,
    cash,
    qty: finish && valuation ? qty : qty,
    cost: finish ? (valuation ? cost : 0) : cost,
    buyFillDay: finish ? null : buyFillDay,
    takeoverNav,
    takeoverMark: init.takeoverMark,
    bookValue: init.bookValue,
    finalEquity,
    returnRatio,
    returnPpm,
    returnPct: formatReturnPct(returnPpm),
    mddPpm,
    equityCash,
    maxOrders,
  };
}

export function settlePuzzle(opts) {
  return replayPuzzle({ ...opts, finish: true });
}

/**
 * Buy-hold benchmark vs takeover NAV.
 * - Starting long: hold through last close.
 * - Starting flat: buy on day-1 decision → fill day-2 open, hold to last close.
 */
export function puzzleBuyHoldBenchmarkPpm({ bars, initialState }) {
  const init = normalizeInitialState(initialState, bars);
  if (!init.ok) throw new Error(init.message);
  const gameDays = bars.length;
  let final;
  if (init.state.qty > 0) {
    final = init.state.qty * bars[gameDays - 1].close; // cash 0
  } else {
    const buyPrice = bars[1].open; // day-1 decision → day-2 open
    const qty = init.state.cash / buyPrice;
    final = qty * bars[gameDays - 1].close;
  }
  return roundHalfUp((final / init.takeoverNav - 1) * 1e6);
}

/**
 * Star scoring. Goals published in level config; never mutated after settle.
 *
 * goals: {
 *   twoStar: { beatBuyHoldPp?: number },  // percentage points vs buy-hold
 *   threeStar: { maxMddPct?: number, maxOrders?: number }
 * }
 */
export function scorePuzzleStars({ returnPpm, mddPpm, orderCount, benchmarkReturnPpm, goals }) {
  const g = goals || {};
  const two = g.twoStar || {};
  const three = g.threeStar || {};
  let stars = 1; // legal settle
  const beatPp = two.beatBuyHoldPp;
  let twoOk = true;
  if (beatPp != null) {
    const edgePpm = returnPpm - benchmarkReturnPpm;
    twoOk = edgePpm >= roundHalfUp(Number(beatPp) * 10000);
  }
  if (twoOk) stars = 2;
  if (stars >= 2) {
    let threeOk = true;
    if (three.maxMddPct != null) {
      threeOk = threeOk && mddPpm <= roundHalfUp(Number(three.maxMddPct) / 100 * 1e6);
    }
    if (three.maxOrders != null) {
      threeOk = threeOk && orderCount <= Number(three.maxOrders);
    }
    if (threeOk && (three.maxMddPct != null || three.maxOrders != null || twoOk)) {
      // Require at least one explicit three-star constraint, or inherit two-star-only → still 2
      if (three.maxMddPct != null || three.maxOrders != null) {
        if (threeOk) stars = 3;
      }
    }
  }
  return {
    stars,
    twoStarMet: stars >= 2,
    threeStarMet: stars >= 3,
    edgePpm: returnPpm - benchmarkReturnPpm,
  };
}

export const PuzzleEngine = {
  PUZZLE_RULE_VERSION,
  PUZZLE_FILL_MODE,
  PUZZLE_ACTIONS,
  PUZZLE_MIN_DAYS,
  PUZZLE_MAX_DAYS,
  normalizeInitialState,
  replayPuzzle,
  settlePuzzle,
  puzzleBuyHoldBenchmarkPpm,
  scorePuzzleStars,
  roundHalfUp,
  formatReturnPct,
};

if (typeof globalThis !== 'undefined') {
  globalThis.PuzzleEngine = PuzzleEngine;
}

export default PuzzleEngine;
