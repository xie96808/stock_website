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

function resolveDatasetPath() {
  if (process.env.STOCKGAME_DATASET_PATH) {
    return path.resolve(process.env.STOCKGAME_DATASET_PATH);
  }
  const jsonPath = path.join(repoRoot, "data", "stocks_data.json");
  if (fs.existsSync(jsonPath)) return jsonPath;
  throw new Error("stocks_data.json not found; set STOCKGAME_DATASET_PATH");
}

/** Content sha256 — same value as static `pack-meta.datasetSha` / versioned pack filename. */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
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
  const raw = fs.readFileSync(filePath, "utf8");
  const version = sha256File(filePath);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("dataset pack empty or invalid");
  }
  _pack = parsed;
  _version = version;
  _filePath = filePath;

  const db = openDb();
  const existing = db.prepare("SELECT version FROM datasets WHERE version = ?").get(version);
  if (!existing) {
    let dateMin = null;
    let dateMax = null;
    for (const s of parsed) {
      const k = s.kline;
      if (!Array.isArray(k) || !k.length) continue;
      const a = k[0]?.date;
      const b = k[k.length - 1]?.date;
      if (a && (!dateMin || a < dateMin)) dateMin = a;
      if (b && (!dateMax || b > dateMax)) dateMax = b;
    }
    db.prepare(
      `INSERT OR IGNORE INTO datasets (version, file_path, sha256, stock_count, date_min, date_max, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(version, filePath, version, parsed.length, dateMin, dateMax);
  }
  return { pack: _pack, version: _version, filePath: _filePath };
}

/** Reset cached pack (tests). */
export function resetDatasetCache() {
  _pack = null;
  _version = null;
  _filePath = null;
}

/**
 * Pick a random eligible stock + window.
 * @param {{ rng?: () => number, stockIndex?: number, windowStartIndex?: number, historyLength?: number }} [opts]
 */
export function pickRandomWindow(opts = {}) {
  const { pack, version } = ensureDatasetLoaded();
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;

  const eligible = [];
  for (let i = 0; i < pack.length; i++) {
    const stock = pack[i];
    const kline = stock?.kline;
    if (!Array.isArray(kline) || kline.length < GAME_DAYS) continue;
    const historyLength = Math.min(DEFAULT_HISTORY, kline.length - GAME_DAYS);
    const minStart = historyLength;
    const maxStart = kline.length - GAME_DAYS; // inclusive
    if (maxStart < minStart) continue;
    // Validate at least one window's game bars
    let ok = false;
    for (let s = minStart; s <= maxStart; s++) {
      const slice = kline.slice(s, s + GAME_DAYS);
      if (slice.length === GAME_DAYS && slice.every(isValidBar)) {
        ok = true;
        break;
      }
    }
    if (ok) eligible.push({ index: i, historyLength, minStart, maxStart });
  }
  if (!eligible.length) throw new Error("no eligible stocks in dataset");

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
  const historyBars = stock.kline
    .slice(windowStart - historyLength, windowStart)
    .map(normalizeBar);
  const gameBars = stock.kline.slice(windowStart, windowStart + GAME_DAYS).map(normalizeBar);
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
  const kline = stock?.kline;
  if (!Array.isArray(kline)) throw new Error("pickPuzzleWindow: stock has no kline");

  const minStart = historyLength;
  const maxStart = kline.length - gameDays;
  if (maxStart < minStart) throw new Error("pickPuzzleWindow: series too short");
  if (windowStart < minStart || windowStart > maxStart) {
    throw new Error("pickPuzzleWindow: windowStartIndex out of range");
  }

  const historyBars = kline.slice(windowStart - historyLength, windowStart).map(normalizeBar);
  const gameBars = kline.slice(windowStart, windowStart + gameDays).map(normalizeBar);
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
