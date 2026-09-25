/**
 * Simulated T+0 mark-to-market for one 241-bar minute tape.
 * Pure functions: no DOM, no database, and not replayGame's T+1 loop.
 */
import { roundHalfUp } from './engine.js';

export const NAV_SCALE = 1_000_000_000;
export const COMMISSION_PPM = 250;
export const STAMP_PPM = 500;
export const SCORE_VERSION_INTRADAY_V1 = 'intraday-t0-mtm-v1';
/** Locked bar interval. 241 bars finish in 24.1s. */
export const INTRADAY_RANKED_BAR_MS = 100;
/** Late act window after a bar is revealed. Not a playback speed. */
export const INTRADAY_ACT_SLACK_MS = 400;
export const INTRADAY_BAR_COUNT = 241;

const PPM_DENOM = 1_000_000;
const SIDES = new Set(['buy', 'sell']);

function fail(code, message) {
  return { ok: false, code, message };
}

/** (nav / NAV_SCALE - 1) * 1e6 = (nav - NAV_SCALE) / 1000 */
function returnPpmFrom(nav) {
  return roundHalfUp((nav - NAV_SCALE) / 1000);
}

function mulRound(a, b, den) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(den) || den === 0) {
    return null;
  }
  const prod = a * b;
  if (!Number.isSafeInteger(prod)) return null;
  return roundHalfUp(prod / den);
}

function bookFrom(startMode, openFen) {
  if (startMode === 'flat') {
    return { cash: NAV_SCALE, sharesNum: 0, sharesDen: 1, position: 'empty' };
  }
  // Opening inventory is yesterday's lot: no commission on this synthetic long.
  return { cash: 0, sharesNum: NAV_SCALE, sharesDen: openFen, position: 'long' };
}

/**
 * Buy keeps commission only. Sell and close liquidation keep commission plus stamp.
 * `fees: false` zeros both so fee drag is the same walk with a switch, not a second engine.
 */
function factors(fees) {
  const commission = fees ? COMMISSION_PPM : 0;
  const stamp = fees ? STAMP_PPM : 0;
  return {
    buy: PPM_DENOM - commission,
    sell: PPM_DENOM - commission - stamp,
  };
}

function applyFill(book, side, fillFen, factor) {
  if (side === 'buy') {
    const cashAfter = mulRound(book.cash, factor, PPM_DENOM);
    if (cashAfter == null) return null;
    book.cash = 0;
    book.sharesNum = cashAfter;
    book.sharesDen = fillFen;
    book.position = 'long';
    return book;
  }
  const gross = mulRound(book.sharesNum, fillFen, book.sharesDen);
  if (gross == null) return null;
  const net = mulRound(gross, factor, PPM_DENOM);
  if (net == null) return null;
  book.cash = net;
  book.sharesNum = 0;
  book.sharesDen = 1;
  book.position = 'empty';
  return book;
}

function markBook(book, markFen) {
  if (book.position === 'empty') return book.cash;
  return mulRound(book.sharesNum, markFen, book.sharesDen);
}

function liquidate(book, fillFen, factor) {
  if (book.position !== 'long') return 0;
  if (applyFill(book, 'sell', fillFen, factor) == null) return null;
  return 1;
}

/**
 * Ranked and practice share this clock. `intervalMs` is the caller's bar
 * length (production passes INTRADAY_RANKED_BAR_MS). Pause freezes `now`.
 */
export function playbackClock({ originMs, nowMs, intervalMs, barCount, pausedAtMs }) {
  const now = pausedAtMs != null ? pausedAtMs : nowMs;
  const elapsed = now - originMs;
  const raw = elapsed < 0 ? -1 : Math.floor(elapsed / intervalMs);
  const released = raw < 0 ? -1 : Math.min(barCount - 1, raw);
  const tapeClosed = raw >= barCount;
  // Slack after the last reveal so a late fill is not settled away.
  const settleReady = elapsed >= barCount * intervalMs + INTRADAY_ACT_SLACK_MS;
  return { raw, released, tapeClosed, settleReady };
}

/** Fill on bar i must arrive strictly before this instant. Price is that bar's close. */
export function actDeadlineMs(originMs, barIndex) {
  return originMs + (barIndex + 1) * INTRADAY_RANKED_BAR_MS + INTRADAY_ACT_SLACK_MS;
}

function readBand(opts, actionsNeedBand) {
  const hasExplicit = opts.limitUpFen != null || opts.limitDownFen != null;
  if (hasExplicit) {
    if (!Number.isSafeInteger(opts.limitUpFen) || !Number.isSafeInteger(opts.limitDownFen)) {
      return fail('BAD_TAPE', 'limit band must be integers');
    }
    if (opts.limitDownFen <= 0 || opts.limitUpFen <= opts.limitDownFen) {
      return fail('BAD_TAPE', 'limit band is invalid');
    }
    return { ok: true, limitUpFen: opts.limitUpFen, limitDownFen: opts.limitDownFen };
  }
  if (opts.prevCloseFen != null || opts.limitPct != null || actionsNeedBand) {
    if (!Number.isSafeInteger(opts.prevCloseFen) || opts.prevCloseFen <= 0) {
      return fail('BAD_TAPE', 'prevCloseFen required');
    }
    if (opts.limitPct !== 10 && opts.limitPct !== 20) {
      return fail('BAD_TAPE', 'limitPct must be 10 or 20');
    }
    return {
      ok: true,
      limitUpFen: roundHalfUp(opts.prevCloseFen * (100 + opts.limitPct) / 100),
      limitDownFen: roundHalfUp(opts.prevCloseFen * (100 - opts.limitPct) / 100),
    };
  }
  return { ok: true, limitUpFen: null, limitDownFen: null };
}

/**
 * @param {object} opts
 * @param {'flat'|'long'} opts.startMode
 * @param {Array<{closeFen:number}>} opts.bars length 241, fen, may exceed 32767
 * @param {Array<{barIndex:number, side:'buy'|'sell'}>} opts.actions strictly increasing barIndex
 * @param {boolean} [opts.fees=true]
 * @param {boolean} [opts.finish] liquidate a remaining long at the last close; ignores limits
 * @param {number} [opts.revealThrough] mark bar; default last action, else -1 flat / 0 long
 * @param {number} [opts.prevCloseFen] with limitPct, builds the player-click band
 * @param {10|20} [opts.limitPct]
 * @param {number} [opts.limitUpFen] precomputed band; wins over prevCloseFen
 * @param {number} [opts.limitDownFen]
 * @param {number} [opts.originMs] with nowMs, enforces FUTURE_BAR / BAR_CLOSED
 * @param {number} [opts.nowMs]
 * @param {number|null} [opts.pausedAtMs]
 */
export function replayIntraday(opts = {}) {
  const startMode = opts.startMode;
  if (startMode !== 'flat' && startMode !== 'long') {
    return fail('BAD_TAPE', 'startMode must be flat or long');
  }
  const bars = opts.bars;
  if (!Array.isArray(bars) || bars.length !== INTRADAY_BAR_COUNT) {
    return fail('BAD_TAPE', 'bars must be 241 close objects');
  }
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (!bar || typeof bar !== 'object' || Array.isArray(bar)) {
      return fail('BAD_TAPE', `bar ${i} must be a {closeFen} object`);
    }
    if (!Number.isSafeInteger(bar.closeFen) || bar.closeFen <= 0) {
      return fail('BAD_TAPE', `closeFen at ${i} must be a positive safe integer`);
    }
  }

  const actions = opts.actions == null ? [] : opts.actions;
  if (!Array.isArray(actions)) return fail('BAD_TAPE', 'actions must be an array');

  let revealThrough = null;
  const revealExplicit = opts.revealThrough != null;
  if (revealExplicit) {
    if (!Number.isInteger(opts.revealThrough) || opts.revealThrough < -1 || opts.revealThrough >= INTRADAY_BAR_COUNT) {
      return fail('BAD_TAPE', 'revealThrough out of range');
    }
    revealThrough = opts.revealThrough;
  }

  const band = readBand(opts, actions.length > 0);
  if (band.ok === false) return band;

  const timed = opts.originMs != null || opts.nowMs != null || opts.pausedAtMs != null;
  let originMs = null;
  let nowMs = null;
  let pausedAtMs = null;
  if (timed) {
    if (!Number.isInteger(opts.originMs) || !Number.isInteger(opts.nowMs)) {
      return fail('BAD_TAPE', 'originMs and nowMs must be integers');
    }
    if (opts.pausedAtMs != null && !Number.isInteger(opts.pausedAtMs)) {
      return fail('BAD_TAPE', 'pausedAtMs must be an integer');
    }
    originMs = opts.originMs;
    nowMs = opts.nowMs;
    pausedAtMs = opts.pausedAtMs ?? null;
  }

  const fees = opts.fees !== false;
  const withFee = bookFrom(startMode, bars[0].closeFen);
  const noFee = bookFrom(startMode, bars[0].closeFen);
  const feeOn = factors(true);
  const feeOff = factors(false);
  const trades = [];
  let lastBar = -1;

  for (let n = 0; n < actions.length; n += 1) {
    const action = actions[n];
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      return fail('BAD_TAPE', 'action must be an object');
    }
    if (!SIDES.has(action.side) || !Number.isInteger(action.barIndex)) {
      return fail('BAD_TAPE', 'action needs barIndex and side buy or sell');
    }
    const barIndex = action.barIndex;
    if (barIndex < 0) return fail('BAD_TAPE', 'barIndex must be >= 0');
    if (barIndex >= INTRADAY_BAR_COUNT) {
      return fail('FUTURE_BAR', `bar ${barIndex} is not revealed`);
    }
    if (revealExplicit && barIndex > revealThrough) {
      return fail('FUTURE_BAR', `bar ${barIndex} is not revealed`);
    }
    if (barIndex === lastBar) return fail('BAR_ALREADY_ACTED', `bar ${barIndex} already filled`);
    if (barIndex < lastBar) return fail('BAR_CLOSED', `bar ${barIndex} is closed`);
    // Only the newest order is still in the act window. Earlier fills were
    // accepted when they arrived; re-checking them would close every round trip.
    if (timed && n === actions.length - 1) {
      const now = pausedAtMs != null ? pausedAtMs : nowMs;
      if (now < originMs + barIndex * INTRADAY_RANKED_BAR_MS) {
        return fail('FUTURE_BAR', `bar ${barIndex} is not revealed`);
      }
      if (now >= actDeadlineMs(originMs, barIndex)) {
        return fail('BAR_CLOSED', `bar ${barIndex} is closed`);
      }
    }

    const fillFen = bars[barIndex].closeFen;
    if (action.side === 'buy') {
      if (withFee.position !== 'empty') return fail('BUY_WHILE_LONG', 'buy while long');
      if (fillFen >= band.limitUpFen) return fail('LIMIT_UP', `bar ${barIndex} is limit up`);
    } else {
      if (withFee.position !== 'long') return fail('SELL_WHILE_EMPTY', 'sell while empty');
      if (fillFen <= band.limitDownFen) return fail('LIMIT_DOWN', `bar ${barIndex} is limit down`);
    }

    const factorOn = action.side === 'buy' ? feeOn.buy : feeOn.sell;
    const factorOff = action.side === 'buy' ? feeOff.buy : feeOff.sell;
    if (applyFill(withFee, action.side, fillFen, factorOn) == null) {
      return fail('BAD_TAPE', 'fill exceeds safe integer');
    }
    if (applyFill(noFee, action.side, fillFen, factorOff) == null) {
      return fail('BAD_TAPE', 'fill exceeds safe integer');
    }
    trades.push({ side: action.side, barIndex, closeFen: fillFen });
    lastBar = barIndex;
  }

  if (!revealExplicit) {
    if (actions.length > 0) revealThrough = actions[actions.length - 1].barIndex;
    else revealThrough = startMode === 'long' ? 0 : -1;
  }

  let markFee;
  let markFree;
  if (revealThrough < 0) {
    if (withFee.position !== 'empty') return fail('BAD_TAPE', 'cannot mark a long book before bar 0');
    markFee = withFee.cash;
    markFree = noFee.cash;
  } else {
    const markFen = bars[revealThrough].closeFen;
    markFee = markBook(withFee, markFen);
    markFree = markBook(noFee, markFen);
    if (markFee == null || markFree == null) return fail('BAD_TAPE', 'mark exceeds safe integer');
  }

  const finish = opts.finish === true;
  let liquidation = 0;
  if (finish) {
    const lastFen = bars[INTRADAY_BAR_COUNT - 1].closeFen;
    const liqFee = liquidate(withFee, lastFen, feeOn.sell);
    const liqFree = liquidate(noFee, lastFen, feeOff.sell);
    if (liqFee == null || liqFree == null) return fail('BAD_TAPE', 'liquidation exceeds safe integer');
    liquidation = liqFee;
  }

  const endFee = finish ? withFee.cash : markFee;
  const endFree = finish ? noFee.cash : markFree;
  const book = fees ? withFee : noFee;
  const endNav = fees ? endFee : endFree;
  const markNav = fees ? markFee : markFree;

  return {
    ok: true,
    scoreVersion: SCORE_VERSION_INTRADAY_V1,
    startMode,
    finish,
    fees,
    position: book.position,
    endPosition: book.position,
    cash: book.cash,
    sharesNum: book.sharesNum,
    sharesDen: book.sharesDen,
    markNav,
    markReturnPpm: returnPpmFrom(markNav),
    endNav,
    returnPpm: returnPpmFrom(endNav),
    tradeCount: trades.length,
    feeDragPpm: returnPpmFrom(endFree) - returnPpmFrom(endFee),
    liquidation,
    trades,
  };
}
