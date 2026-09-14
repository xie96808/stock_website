/**
 * R5 classic cloud seed from GameWindowDTO — no catalog / full pack required.
 * See docs/r5-game-window-dto.md.
 */
import { getSession, patchSession } from './game-session.js';

/** True when cloud payload carries a playable GameWindowDTO. */
export function hasGameWindowDto(cloud) {
  const win = cloud && cloud.window;
  return !!(win && Array.isArray(win.bars) && win.bars.length > 0);
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
