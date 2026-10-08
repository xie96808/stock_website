import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/connection.js";
import { RULE_VERSION, GAME_DAYS } from "../../../shared/rules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const DEFAULT_HISTORY = 30;

let _pack = null;
let _version = null;
let _filePath = null;
/** @type {string[]} */
let _dateTable = [];
/** @type {{ index: number, historyLength: number, minStart: number, maxStart: number }[] | null} */
let _eligible = null;

function resolveDatasetPath() {
  if (process.env.STOCKGAME_DATASET_PATH) {
    return path.resolve(process.env.STOCKGAME_DATASET_PATH);
  }
  const jsonPath = path.join(repoRoot, "data", "stocks_data.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  throw new Error("stocks_data.json not found; set STOCKGAME_DATASET_PATH");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function isValidBar(bar) {
  if (!bar || typeof bar !== "object") return false;
  const { open, high, low, close } = bar;
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return false;
  if (high < Math.max(open, close) || low > Math.min(open, close)) return false;
  if (high < low) return false;
  return true;
}

/** Validate bar at index without allocating an object (same rules as isValidBar). */
function isValidBarAt(stock, i) {
  const open = stock.open[i];
  const high = stock.high[i];
  const low = stock.low[i];
  const close = stock.close[i];
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return false;
  if (high < Math.max(open, close) || low > Math.min(open, close)) return false;
  if (high < low) return false;
  return true;
}

function normalizeBar(bar) {
  return {
    date: String(bar.date || ""),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: bar.volume != null ? Number(bar.volume) : 0,
  };
}

/**
 * Plain OHLCV object at index — shape matches former `stock.kline[i]`.
 * @param {{ n: number, dates: Int32Array, open: Float64Array, high: Float64Array, low: Float64Array, close: Float64Array, volume: Float64Array }} stock
 * @param {number} i
 */
export function getBar(stock, i) {
  // Property order matches stocks_data.json bars (open/close before high/low)
  // so JSON.stringify of pack slices is byte-identical to the object-pack era.
  return {
    date: _dateTable[stock.dates[i]],
    open: stock.open[i],
    close: stock.close[i],
    high: stock.high[i],
    low: stock.low[i],
    volume: stock.volume[i],
  };
}

/** K-line length for a columnar stock. */
export function getKlineLength(stock) {
  return stock?.n ?? 0;
}

/**
 * Slice [start, end) as array-of-objects (same shape as former `kline.slice`).
 * @param {object} stock
 * @param {number} start
 * @param {number} end
 */
export function sliceBars(stock, start, end) {
  const n = stock.n;
  const s = Math.max(0, start | 0);
  const e = Math.min(n, end | 0);
  const out = [];
  for (let i = s; i < e; i++) out.push(getBar(stock, i));
  return out;
}

/**
 * Convert parsed JSON pack (array of {code,name,py,jp,kline:[{date,open,...}]})
 * into columnar stocks. Uses Float64 for all numerics so JSON serialization of
 * emitted numbers stays bit/string-identical to the object-pack era.
 * Dates are interned into a shared string table + Int32Array indices.
 */
function toColumnarPack(parsed) {
  /** @type {Map<string, number>} */
  const dateIndex = new Map();
  /** @type {string[]} */
  const dateTable = [];

  function internDate(d) {
    const key = String(d || "");
    let idx = dateIndex.get(key);
    if (idx !== undefined) return idx;
    idx = dateTable.length;
    dateTable.push(key);
    dateIndex.set(key, idx);
    return idx;
  }

  const pack = new Array(parsed.length);
  for (let si = 0; si < parsed.length; si++) {
    const s = parsed[si];
    const kline = Array.isArray(s?.kline) ? s.kline : [];
    const n = kline.length;
    const dates = new Int32Array(n);
    const open = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    const volume = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = kline[i] || {};
      dates[i] = internDate(b.date);
      open[i] = Number(b.open);
      high[i] = Number(b.high);
      low[i] = Number(b.low);
      close[i] = Number(b.close);
      volume[i] = b.volume != null ? Number(b.volume) : 0;
    }
    pack[si] = {
      code: s.code,
      name: s.name,
      py: s.py,
      jp: s.jp,
      n,
      dates,
      open,
      high,
      low,
      close,
      volume,
    };
    // Drop object kline ASAP so peak RSS does not hold both representations.
    parsed[si] = null;
  }
  return { pack, dateTable };
}

function buildEligible(pack) {
  const eligible = [];
  for (let i = 0; i < pack.length; i++) {
    const stock = pack[i];
    const n = stock?.n ?? 0;
    if (n < GAME_DAYS) continue;
    const historyLength = Math.min(DEFAULT_HISTORY, n - GAME_DAYS);
    const minStart = historyLength;
    const maxStart = n - GAME_DAYS; // inclusive
    if (maxStart < minStart) continue;
    let ok = false;
    for (let s = minStart; s <= maxStart; s++) {
      let windowOk = true;
      for (let d = 0; d < GAME_DAYS; d++) {
        if (!isValidBarAt(stock, s + d)) {
          windowOk = false;
          break;
        }
      }
      if (windowOk) {
        ok = true;
        break;
      }
    }
    if (ok) eligible.push({ index: i, historyLength, minStart, maxStart });
  }
  return eligible;
}

export function getDatasetMeta() {
  ensureDatasetLoaded();
  return {
    datasetVersion: _version,
    filePath: _filePath,
    stockCount: _pack.length,
    ruleVersion: RULE_VERSION,
  };
}

export function ensureDatasetLoaded() {
  if (_pack && _version) return { pack: _pack, version: _version, filePath: _filePath };
  const filePath = resolveDatasetPath();
  // Single read: hash file bytes, then parse from the same buffer.
  let buf = fs.readFileSync(filePath);
  const version = crypto.createHash("sha256").update(buf).digest("hex");
  const parsed = JSON.parse(buf.toString("utf8"));
  buf = null; // drop file bytes before columnar conversion
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("dataset pack empty or invalid");
  }
  const { pack, dateTable } = toColumnarPack(parsed);
  // Release object-graph refs as soon as columnar pack is ready (toColumnarPack
  // already nulls per-stock kline; clear the array shell too).
  parsed.length = 0;
  _pack = pack;
  _dateTable = dateTable;
  _eligible = buildEligible(pack);
  _version = version;
  _filePath = filePath;

  const db = openDb();
  const existing = db.prepare("SELECT version FROM datasets WHERE version = ?").get(version);
  if (!existing) {
    let dateMin = null;
    let dateMax = null;
    for (const s of pack) {
      if (!s.n) continue;
      const a = _dateTable[s.dates[0]];
      const b = _dateTable[s.dates[s.n - 1]];
      if (a && (!dateMin || a < dateMin)) dateMin = a;
      if (b && (!dateMax || b > dateMax)) dateMax = b;
    }
    db.prepare(
      `INSERT OR IGNORE INTO datasets (version, file_path, sha256, stock_count, date_min, date_max, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(version, filePath, version, pack.length, dateMin, dateMax);
  }
  return { pack: _pack, version: _version, filePath: _filePath };
}

/** Reset cached pack (tests). */
export function resetDatasetCache() {
  _pack = null;
  _version = null;
  _filePath = null;
  _dateTable = [];
  _eligible = null;
}

/**
 * Pick a random eligible stock + window.
 * @param {{ rng?: () => number, stockIndex?: number, windowStartIndex?: number, historyLength?: number }} [opts]
 */
export function pickRandomWindow(opts = {}) {
  const { pack, version } = ensureDatasetLoaded();
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;

  const eligible = _eligible;
  if (!eligible?.length) throw new Error("no eligible stocks in dataset");

  let chosen;
  if (Number.isInteger(opts.stockIndex)) {
    chosen = eligible.find((e) => e.index === opts.stockIndex);
    if (!chosen) throw new Error("requested stockIndex not eligible");
  } else {
    chosen = eligible[Math.floor(rng() * eligible.length)];
  }

  const stock = pack[chosen.index];
  let windowStart;
  if (Number.isInteger(opts.windowStartIndex)) {
    windowStart = opts.windowStartIndex;
    if (windowStart < chosen.minStart || windowStart > chosen.maxStart) {
      throw new Error("windowStartIndex out of range");
    }
  } else {
    const span = chosen.maxStart - chosen.minStart + 1;
    windowStart = chosen.minStart + Math.floor(rng() * span);
  }

  const historyLength =
    Number.isInteger(opts.historyLength) ? opts.historyLength : chosen.historyLength;
  const historyBars = sliceBars(stock, windowStart - historyLength, windowStart).map(normalizeBar);
  const gameBars = sliceBars(stock, windowStart, windowStart + GAME_DAYS).map(normalizeBar);
  if (gameBars.length !== GAME_DAYS || !gameBars.every(isValidBar)) {
    throw new Error("picked window has invalid OHLC");
  }

  const snapshot = {
    v: 1,
    stockCode: String(stock.code),
    stockName: String(stock.name || stock.code),
    stockIndex: chosen.index,
    windowStartIndex: windowStart,
    historyLength,
    gameDays: GAME_DAYS,
    history: historyBars,
    // SettlementSnapshot bars keep OHLCV (engine ignores volume; GameWindowDTO needs it).
    bars: gameBars.map(({ date, open, high, low, close, volume }) => ({
      date,
      open,
      high,
      low,
      close,
      volume: volume != null ? Number(volume) : 0,
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotSha256 = sha256Text(snapshotJson);

  return {
    datasetVersion: version,
    ruleVersion: RULE_VERSION,
    stockCode: snapshot.stockCode,
    stockName: snapshot.stockName,
    stockIndex: snapshot.stockIndex,
    windowStartIndex: windowStart,
    historyLength,
    gameDays: GAME_DAYS,
    snapshot,
    snapshotJson,
    snapshotSha256,
  };
}


/**
 * Puzzle-friendly fixed slice: custom gameDays (6..10) + historyLength.
 * Requires stockIndex + windowStartIndex (authored pins). Classic pickRandomWindow stays GAME_DAYS=30.
 * @param {{ stockIndex: number, windowStartIndex: number, gameDays: number, historyLength?: number }} opts
 */
export function pickPuzzleWindow(opts = {}) {
  const { pack, version } = ensureDatasetLoaded();
  const stockIndex = opts.stockIndex;
  const windowStart = opts.windowStartIndex;
  const gameDays = opts.gameDays;
  const historyLength = Number.isInteger(opts.historyLength) ? opts.historyLength : DEFAULT_HISTORY;

  if (!Number.isInteger(stockIndex) || stockIndex < 0 || stockIndex >= pack.length) {
    throw new Error("pickPuzzleWindow: invalid stockIndex");
  }
  if (!Number.isInteger(gameDays) || gameDays < 6 || gameDays > 10) {
    throw new Error("pickPuzzleWindow: gameDays must be 6..10");
  }
  if (!Number.isInteger(historyLength) || historyLength < 0) {
    throw new Error("pickPuzzleWindow: invalid historyLength");
  }
  if (!Number.isInteger(windowStart)) {
    throw new Error("pickPuzzleWindow: windowStartIndex required");
  }

  const stock = pack[stockIndex];
  const n = stock?.n ?? 0;
  if (!n) throw new Error("pickPuzzleWindow: stock has no kline");

  const minStart = historyLength;
  const maxStart = n - gameDays;
  if (maxStart < minStart) throw new Error("pickPuzzleWindow: series too short");
  if (windowStart < minStart || windowStart > maxStart) {
    throw new Error("pickPuzzleWindow: windowStartIndex out of range");
  }

  const historyBars = sliceBars(stock, windowStart - historyLength, windowStart).map(normalizeBar);
  const gameBars = sliceBars(stock, windowStart, windowStart + gameDays).map(normalizeBar);
  if (historyBars.length !== historyLength || gameBars.length !== gameDays) {
    throw new Error("pickPuzzleWindow: slice length mismatch");
  }
  if (!gameBars.every(isValidBar) || (historyLength > 0 && !historyBars.every(isValidBar))) {
    throw new Error("pickPuzzleWindow: invalid OHLC in slice");
  }

  const snapshot = {
    v: 1,
    stockCode: String(stock.code),
    stockName: String(stock.name || stock.code),
    stockIndex,
    windowStartIndex: windowStart,
    historyLength,
    gameDays,
    history: historyBars,
    bars: gameBars.map(({ date, open, high, low, close, volume }) => ({
      date,
      open,
      high,
      low,
      close,
      volume: volume != null ? Number(volume) : 0,
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);
  return {
    datasetVersion: version,
    stockCode: snapshot.stockCode,
    stockName: snapshot.stockName,
    stockIndex,
    windowStartIndex: windowStart,
    historyLength,
    gameDays,
    snapshot,
    snapshotJson,
    snapshotSha256: sha256Text(snapshotJson),
  };
}


export { sha256Text, DEFAULT_HISTORY, GAME_DAYS };
