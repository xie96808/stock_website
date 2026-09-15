/**
 * R5 classic cloud seed from GameWindowDTO — no catalog / full pack required.
 * See docs/r5-game-window-dto.md.
 */
import { getSession, patchSession } from './game-session.js';

const OHLCV_KEYS = ['date', 'open', 'high', 'low', 'close', 'volume'];

/** True when cloud payload carries a playable GameWindowDTO (enter-gate). */
export function hasGameWindowDto(cloud) {
  const win = cloud && cloud.window;
  return !!(win && Array.isArray(win.bars) && win.bars.length > 0);
}

/**
 * Start-flow / daily enter: await full pack only when no window DTO.
 * When false, pack may still load in parallel but must not block enter.
 */
export function mustAwaitPackBeforeEnter(cloud) {
  return !hasGameWindowDto(cloud);
}

function barHasOhlcv(bar) {
  if (!bar || typeof bar !== 'object') return false;
  for (const k of OHLCV_KEYS) {
    if (!(k in bar)) return false;
  }
  return (
    Number.isFinite(Number(bar.open)) &&
    Number.isFinite(Number(bar.high)) &&
    Number.isFinite(Number(bar.low)) &&
    Number.isFinite(Number(bar.close)) &&
    Number.isFinite(Number(bar.volume))
  );
}

/**
 * Strict classic GameWindowDTO shape (history + bars + OHLCV/volume).
 * Used for validation / tests; enter-gate stays {@link hasGameWindowDto}.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateGameWindowDtoShape(win) {
  if (!win || typeof win !== 'object') {
    return { ok: false, reason: 'missing' };
  }
  if (win.v != null && win.v !== 1) {
    return { ok: false, reason: 'bad_v' };
  }
  if (!Array.isArray(win.bars) || win.bars.length === 0) {
    return { ok: false, reason: 'bars' };
  }
  if (!Array.isArray(win.history)) {
    return { ok: false, reason: 'history' };
  }
  const gameDays = Number.isInteger(win.gameDays) ? win.gameDays : win.bars.length;
  const historyLength = Number.isInteger(win.historyLength)
    ? win.historyLength
    : win.history.length;
  if (win.bars.length !== gameDays) {
    return { ok: false, reason: 'bars_length' };
  }
  if (win.history.length !== historyLength) {
    return { ok: false, reason: 'history_length' };
  }
  if (!barHasOhlcv(win.bars[0])) {
    return { ok: false, reason: 'bars_ohlcv' };
  }
  if (win.history.length > 0 && !barHasOhlcv(win.history[0])) {
    return { ok: false, reason: 'history_ohlcv' };
  }
  return { ok: true };
}

/** @returns {boolean} */
export function isWellFormedGameWindowDto(win) {
  return validateGameWindowDtoShape(win).ok;
}

/**
 * Apply classic cloud session fields from `cloud.window`.
 * @param {object} cloud — create/active session public DTO
 */
export function seedClassicFromWindow(cloud) {
  const win = cloud.window;
  const bars = win.bars;
  const history = Array.isArray(win.history) ? win.history : [];
  const gameDays = Number.isInteger(win.gameDays) ? win.gameDays : bars.length;
  const historyDays = Number.isInteger(win.historyLength)
    ? win.historyLength
    : history.length;
  if (bars.length !== gameDays) {
    throw new Error('云端行情窗口无效');
  }
  if (history.length !== historyDays) {
    throw new Error('云端历史窗口无效');
  }
  const currentStock = {
    code: cloud.stockCode || 'CLOUD',
    name: cloud.stockName || '云端对局',
    kline: history.concat(bars),
  };
  patchSession({
    cloudMode: true,
    cloudGameId: cloud.gameId,
    datasetVersion: cloud.datasetVersion || null,
    ruleVersion: cloud.ruleVersion || getSession().ruleVersion,
    fillMode: cloud.fillMode || getSession().fillMode,
    protocolVersion: cloud.protocolVersion || null,
    gameKind: cloud.gameKind || 'classic',
    gameDays,
    revision: cloud.revision ?? 0,
    undoCount: cloud.undoCount ?? 0,
    assistClass: cloud.assistClass || null,
    currentStock,
    historyLength: historyDays,
    gameKline: history.concat(bars),
    practiceOnly: false,
  });
}
