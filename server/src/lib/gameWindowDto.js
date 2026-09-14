/**
 * GameWindowDTO — playable OHLCV window for cloud clients.
 * See docs/r5-game-window-dto.md.
 *
 * SettlementSnapshot stays in snapshot_json; this module only builds the
 * API play payload (may enrich volume without mutating stored snapshot).
 */
import { ensureDatasetLoaded } from "./dataset.js";

export const GAME_WINDOW_DTO_V = 1;

function barHasVolume(bar) {
  return bar && bar.volume != null && Number.isFinite(Number(bar.volume));
}

function withVolume(bar, volume) {
  return {
    date: String(bar.date || ""),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: volume != null && Number.isFinite(Number(volume)) ? Number(volume) : 0,
  };
}

/**
 * Re-slice OHLCV from the active pack when stored game bars lack volume.
 * Returns null if pack/indices unavailable.
 */
function packSliceVolumes(snapshot) {
  try {
    const { pack } = ensureDatasetLoaded();
    const idx = snapshot.stockIndex;
    const start = snapshot.windowStartIndex;
    const histLen = snapshot.historyLength ?? (Array.isArray(snapshot.history) ? snapshot.history.length : 0);
    const gameDays = snapshot.gameDays ?? (Array.isArray(snapshot.bars) ? snapshot.bars.length : 0);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pack.length) return null;
    if (!Number.isInteger(start) || !Number.isInteger(histLen) || !Number.isInteger(gameDays)) return null;
    const kline = pack[idx]?.kline;
    if (!Array.isArray(kline)) return null;
    const history = kline.slice(start - histLen, start);
    const bars = kline.slice(start, start + gameDays);
    if (history.length !== histLen || bars.length !== gameDays) return null;
    return { history, bars };
  } catch {
    return null;
  }
}

/**
 * @param {object|null} snapshot — parsed SettlementSnapshot (or equivalent)
 * @returns {{ v: number, historyLength: number, gameDays: number, history: object[], bars: object[] }|null}
 */
export function buildGameWindowDto(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.bars) || !snapshot.bars.length) return null;
  const historyRaw = Array.isArray(snapshot.history) ? snapshot.history : [];
  const barsRaw = snapshot.bars;
  const historyLength =
    Number.isInteger(snapshot.historyLength) ? snapshot.historyLength : historyRaw.length;
  const gameDays = Number.isInteger(snapshot.gameDays) ? snapshot.gameDays : barsRaw.length;
  if (barsRaw.length !== gameDays) return null;
  if (historyRaw.length !== historyLength) return null;

  const needVol =
    barsRaw.some((b) => !barHasVolume(b)) ||
    historyRaw.some((b) => !barHasVolume(b));
  const packSlice = needVol ? packSliceVolumes(snapshot) : null;

  const history = historyRaw.map((b, i) => {
    if (barHasVolume(b)) return withVolume(b, b.volume);
    const fromPack = packSlice?.history?.[i];
    return withVolume(b, fromPack?.volume ?? 0);
  });
  const bars = barsRaw.map((b, i) => {
    if (barHasVolume(b)) return withVolume(b, b.volume);
    const fromPack = packSlice?.bars?.[i];
    return withVolume(b, fromPack?.volume ?? 0);
  });

  return {
    v: GAME_WINDOW_DTO_V,
    historyLength,
    gameDays,
    history,
    bars,
  };
}

/** Attach `window` from row.snapshot_json when parseable. */
export function windowFromSessionRow(row) {
  if (!row?.snapshot_json) return null;
  try {
    return buildGameWindowDto(JSON.parse(row.snapshot_json));
  } catch {
    return null;
  }
}
