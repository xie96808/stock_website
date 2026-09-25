/**
 * Minute-tape shape for 分时操作. Pure checks, no DOM and no network.
 * On-disk rows are compact JSONL; playback timestamps are em241-v1 by index.
 */
import { createHash } from 'node:crypto';
import { roundHalfUp } from './engine.js';

export const INTRADAY_BAR_COUNT = 241;
export const INTRADAY_CLOCK = 'em241-v1';
export const TAPE_VERSION = 1;
export const UNIVERSE_LIMIT = 200;
/** More than this many zero-volume bars drops the session. */
export const MAX_ZERO_VOLUME_BARS = 5;
/**
 * Vendor 均价 is a cumulative VWAP rounded on its own.
 * A 1 fen gap is allowed; a wider gap drops the day.
 */
export const AVG_FEN_TOLERANCE = 1;

function pushClock(out, hour, minute, count) {
  let h = hour;
  let m = minute;
  for (let i = 0; i < count; i += 1) {
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 60) {
      m = 0;
      h += 1;
    }
  }
}

/** 09:30 auction print, 09:31–11:30, 13:01–15:00. No 09:15–09:25. */
function buildEm241Times() {
  const out = ['09:30'];
  pushClock(out, 9, 31, 120);
  pushClock(out, 13, 1, 120);
  return out;
}

export const EM241_TIMES = Object.freeze(buildEm241Times());
const EM241_SET = new Set(EM241_TIMES);

function fail(reason, index) {
  const out = { ok: false, reason };
  if (index != null) out.index = index;
  return out;
}

export function fenFromYuan(yuan) {
  return roundHalfUp(Number(yuan) * 100);
}

export function normalizeSymbol(symbol) {
  let text = String(symbol ?? '').trim().toLowerCase();
  if (text.startsWith('sh') || text.startsWith('sz') || text.startsWith('bj')) {
    text = text.slice(2);
  }
  return text;
}

export function isBeijingSymbol(symbol) {
  const code = normalizeSymbol(symbol);
  return code.startsWith('4') || code.startsWith('8');
}

/** Names that must not enter the pool: ST prefixes, or anything marked 退. */
export function isExcludedName(name) {
  const text = String(name ?? '').trim();
  return text.startsWith('S*ST') || text.startsWith('*ST') || text.startsWith('ST') || text.includes('退');
}

/** 688/689 and 300/301 are 20%; other Shanghai/Shenzhen names are 10%. */
export function limitPctForSymbol(symbol) {
  const code = normalizeSymbol(symbol);
  if (
    code.startsWith('688')
    || code.startsWith('689')
    || code.startsWith('300')
    || code.startsWith('301')
  ) {
    return 20;
  }
  return 10;
}

export function limitBandFen(prevCloseFen, limitPct) {
  return {
    limitUpFen: roundHalfUp(prevCloseFen * (100 + limitPct) / 100),
    limitDownFen: roundHalfUp(prevCloseFen * (100 - limitPct) / 100),
  };
}

export function isLimitLockedOpen(prevCloseFen, limitPct, openCloseFen) {
  const band = limitBandFen(prevCloseFen, limitPct);
  return openCloseFen >= band.limitUpFen || openCloseFen <= band.limitDownFen;
}

/**
 * First `limit` names in file order that still have kline, then drop ST and Beijing.
 * Dropped names are not backfilled from later in the file.
 * @param {Array<{code?: string, symbol?: string, name?: string, kline?: unknown[]}>} stocks
 */
export function selectUniverse(stocks, limit = UNIVERSE_LIMIT) {
  if (!Array.isArray(stocks)) return [];
  const head = [];
  for (const stock of stocks) {
    if (!stock || !Array.isArray(stock.kline) || stock.kline.length === 0) continue;
    head.push(stock);
    if (head.length >= limit) break;
  }
  return head.filter((stock) => {
    const code = stock.code ?? stock.symbol;
    return !isExcludedName(stock.name) && !isBeijingSymbol(code);
  });
}

export function clockHm(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let tail = text;
  if (tail.includes('T')) tail = tail.split('T').pop();
  else if (tail.includes(' ')) tail = tail.split(' ').pop();
  const hm = tail.slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(hm)) return null;
  return hm;
}

/**
 * Exact em241-v1 set. Missing or extra stamps fail; nothing is filled in.
 * @param {Array<string|{time?: string, timestamp?: string}>} rows
 */
export function alignEm241(rows) {
  if (!Array.isArray(rows)) return fail('timestamp_mismatch');
  const byTime = new Map();
  for (const row of rows) {
    const raw = row != null && typeof row === 'object' ? (row.time ?? row.timestamp ?? row) : row;
    const hm = clockHm(raw);
    if (!hm || !EM241_SET.has(hm) || byTime.has(hm)) return fail('timestamp_mismatch');
    byTime.set(hm, row);
  }
  if (byTime.size !== INTRADAY_BAR_COUNT) return fail('timestamp_mismatch');
  const ordered = [];
  for (const hm of EM241_TIMES) {
    if (!byTime.has(hm)) return fail('timestamp_mismatch');
    ordered.push(byTime.get(hm));
  }
  return { ok: true, reason: null, bars: ordered };
}

export function decodeTapeBar(bar) {
  if (Array.isArray(bar)) {
    if (bar.length !== 4) return null;
    return {
      closeFen: bar[0],
      volumeLot: bar[1],
      amountFen: bar[2],
      avgFen: bar[3],
    };
  }
  if (bar && typeof bar === 'object') {
    return {
      closeFen: bar.closeFen,
      volumeLot: bar.volumeLot,
      amountFen: bar.amountFen,
      avgFen: bar.avgFen,
    };
  }
  return null;
}

export function decodeTapeBars(bars) {
  if (!Array.isArray(bars)) return null;
  const decoded = [];
  for (const bar of bars) {
    const row = decodeTapeBar(bar);
    if (!row) return null;
    decoded.push(row);
  }
  return decoded;
}

/** Engine input: close only. Values above 32767 stay as JS numbers. */
export function toCloseBars(bars) {
  const decoded = decodeTapeBars(bars);
  if (!decoded) return null;
  const closes = [];
  for (const bar of decoded) {
    if (!Number.isSafeInteger(bar.closeFen)) return null;
    closes.push({ closeFen: bar.closeFen });
  }
  return closes;
}

function isSafeInt(value) {
  return Number.isSafeInteger(value);
}

/**
 * Cumulative 均价. Zero-volume bars are skipped (no divide-by-zero) and must
 * repeat the previous bar's avg. cumLot === 0 never reaches the division.
 */
export function checkCumulativeAverage(bars) {
  let cumLot = 0;
  let cumAmountFen = 0;
  let zeroCount = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar.volumeLot === 0) {
      zeroCount += 1;
      if (bar.amountFen !== 0) return fail('zero_volume_amount', i);
      if (i > 0 && bar.avgFen !== bars[i - 1].avgFen) return fail('avg_mismatch', i);
      continue;
    }
    cumLot += bar.volumeLot;
    cumAmountFen += bar.amountFen;
    if (!(cumLot > 0)) return fail('avg_mismatch', i);
    const vwapFen = roundHalfUp(cumAmountFen / (cumLot * 100));
    if (Math.abs(vwapFen - bar.avgFen) > AVG_FEN_TOLERANCE) return fail('avg_mismatch', i);
  }
  if (zeroCount === bars.length && bars.length > 0) return fail('suspended');
  if (zeroCount > MAX_ZERO_VOLUME_BARS) return fail('too_many_zero_volume');
  return { ok: true, reason: null, zeroCount };
}

export function canonicalTapeJson(tape) {
  const decoded = decodeTapeBars(tape.bars);
  const bars = decoded.map((bar) => [bar.closeFen, bar.volumeLot, bar.amountFen, bar.avgFen]);
  return JSON.stringify({
    v: TAPE_VERSION,
    symbol: normalizeSymbol(tape.symbol),
    name: tape.name,
    sessionDate: tape.sessionDate,
    prevCloseFen: tape.prevCloseFen,
    limitPct: tape.limitPct,
    barCount: INTRADAY_BAR_COUNT,
    clock: INTRADAY_CLOCK,
    bars,
  });
}

export function tapeSha256(tapeOrJson) {
  const json = typeof tapeOrJson === 'string' ? tapeOrJson : canonicalTapeJson(tapeOrJson);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * @param {object} input compact tape row, tuples or {closeFen,volumeLot,amountFen,avgFen}
 * @returns {{ok:true, sha256:string, canonical:object, canonicalJson:string, bars:object[], closes:Array<{closeFen:number}>}|{ok:false, reason:string, index?:number}}
 */
export function validateTape(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('bad_shape');
  if (input.v !== TAPE_VERSION) return fail('bad_version');
  const symbol = normalizeSymbol(input.symbol);
  if (!/^\d{6}$/.test(symbol)) return fail('bad_symbol');
  if (isBeijingSymbol(symbol)) return fail('beijing');
  if (typeof input.name !== 'string' || input.name.length === 0) return fail('bad_shape');
  if (isExcludedName(input.name)) return fail('excluded_name');
  if (typeof input.sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) {
    return fail('bad_session_date');
  }
  if (input.clock !== INTRADAY_CLOCK) return fail('clock');
  if (input.barCount !== INTRADAY_BAR_COUNT) return fail('bar_count');
  if (!Array.isArray(input.bars) || input.bars.length !== INTRADAY_BAR_COUNT) return fail('bar_count');
  const limitPct = limitPctForSymbol(symbol);
  if (input.limitPct !== limitPct) return fail('bad_limit_pct');
  if (!isSafeInt(input.prevCloseFen) || input.prevCloseFen <= 0) return fail('non_positive_price');

  const decoded = [];
  for (let i = 0; i < input.bars.length; i += 1) {
    const bar = decodeTapeBar(input.bars[i]);
    if (!bar) return fail('bad_shape', i);
    if (!isSafeInt(bar.closeFen) || !isSafeInt(bar.avgFen) || !isSafeInt(bar.amountFen)) {
      return fail('non_integer_fen', i);
    }
    if (!isSafeInt(bar.volumeLot) || bar.volumeLot < 0) return fail('non_integer_volume', i);
    if (bar.closeFen <= 0 || bar.avgFen <= 0 || bar.amountFen < 0) return fail('non_positive_price', i);
    decoded.push(bar);
  }

  const avg = checkCumulativeAverage(decoded);
  if (!avg.ok) return avg;
  if (isLimitLockedOpen(input.prevCloseFen, limitPct, decoded[0].closeFen)) {
    return fail('limit_locked_open', 0);
  }

  const canonical = {
    v: TAPE_VERSION,
    symbol,
    name: input.name,
    sessionDate: input.sessionDate,
    prevCloseFen: input.prevCloseFen,
    limitPct,
    barCount: INTRADAY_BAR_COUNT,
    clock: INTRADAY_CLOCK,
    bars: decoded.map((bar) => [bar.closeFen, bar.volumeLot, bar.amountFen, bar.avgFen]),
  };
  const canonicalJson = JSON.stringify(canonical);
  return {
    ok: true,
    reason: null,
    canonical,
    canonicalJson,
    sha256: tapeSha256(canonicalJson),
    bars: decoded,
    closes: decoded.map((bar) => ({ closeFen: bar.closeFen })),
  };
}
