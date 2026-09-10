/**
 * Game session seam — façade over the `gameState` blackboard for in-game
 * session lifecycle (start / progress / settle / share meta).
 *
 * Behavior-preserving Phase-style seam:
 * - Same object identity as `gameState` (callers may still import `gameState`).
 * - Does NOT rename properties or split the catalog (`stocksData`).
 * - Engine rules, scores, K-line visuals, fill modes stay untouched.
 */

import { gameState } from './state.js';

/** Catalog field that lives on the blackboard but is not session lifecycle. */
export const CATALOG_KEY = 'stocksData';

/**
 * In-game session fields owned by this seam.
 * Everything on `gameState` except the stock catalog.
 */
export const SESSION_KEYS = Object.freeze([
  'currentStock',
  'gameKline',
  'historyLength',
  'currentDay',
  'position',
  'costBasis',
  'totalReturn',
  'tradeHistory',
  'valuation',
  'actions',
  'pendingAction',
  'holdingDays',
  'tradeGains',
  'bsScore',
  'bestPoints',
  'fillMode',
  'lastBuyFillDay',
  'ruleVersion',
  'returnPpm',
  'returnPct',
  'cloudMode',
  'cloudGameId',
  'datasetVersion',
  'saveStatus',
  'saveError',
  'practiceOnly',
  'shareRank',
  'shareBoardTotal',
  'shareBeatPct',
]);

const SESSION_KEY_SET = new Set(SESSION_KEYS);

/**
 * Live session blackboard (same reference as `gameState`).
 * Prefer this when new code needs the session API entry point.
 */
export function getSession() {
  return gameState;
}

/** Stock pack catalog array (not cleared by session reset). */
export function getStocksCatalog() {
  return gameState.stocksData;
}

/**
 * Fresh session field bag applied at `startGame` reset.
 * Mirrors the historical inline assignments exactly (no extra clears).
 * Does not touch `stocksData`, `currentStock`, `gameKline`, or share meta —
 * those are overwritten later in start, or cleared at settle via share helpers.
 */
export function buildFreshSessionFields({
  practiceOnly = false,
  fillMode = 'next_open',
} = {}) {
  return {
    currentDay: 1,
    position: 'empty',
    costBasis: 0,
    totalReturn: 1,
    tradeHistory: [],
    pendingAction: null,
    holdingDays: 0,
    tradeGains: [],
    historyLength: 0,
    bsScore: null,
    bestPoints: null,
    fillMode: fillMode === 'same_close' ? 'same_close' : 'next_open',
    lastBuyFillDay: null,
    actions: [],
    valuation: null,
    returnPpm: null,
    returnPct: null,
    ruleVersion: 'sim30-mtm-v1',
    cloudMode: false,
    cloudGameId: null,
    datasetVersion: null,
    saveStatus: null,
    saveError: null,
    practiceOnly: !!practiceOnly,
  };
}

/**
 * Reset in-game session fields for a new start.
 * Preserves `stocksData` and leaves share meta / seed window for callers
 * (identical to prior `startGame` reset block).
 */
export function resetSession(options = {}) {
  const fields = buildFreshSessionFields({
    practiceOnly: !!options.practiceOnly,
    fillMode: options.fillMode || 'next_open',
  });
  Object.assign(gameState, fields);
  return gameState;
}

/**
 * Patch session fields only. Unknown / catalog keys are ignored.
 * Arrays/objects are assigned by reference (same as direct writes).
 */
export function patchSession(partial) {
  if (!partial || typeof partial !== 'object') return gameState;
  for (const key of Object.keys(partial)) {
    if (!SESSION_KEY_SET.has(key)) continue;
    gameState[key] = partial[key];
  }
  return gameState;
}

/**
 * Apply a shared-engine replay/settle result onto the session.
 * Preserves prior `syncFromEngine` semantics (including MTM equity).
 *
 * @param {object} r engine result
 * @param {{ finished?: boolean, bars?: array|null, actionsLength?: number }} opts
 */
export function applyEngineResult(r, { finished = false, bars = null, actionsLength } = {}) {
  gameState.tradeHistory = r.trades.map((t) => ({
    type: t.type,
    day: t.day,
    price: t.price,
    return: t.return != null ? t.return : null,
  }));
  gameState.valuation = r.valuation;
  gameState.tradeGains = r.tradeGains.slice();
  gameState.holdingDays = r.holdingDays;
  gameState.ruleVersion = r.ruleVersion;

  if (finished) {
    gameState.totalReturn = r.equityMultiple;
    gameState.position = 'empty';
    gameState.costBasis = 0;
    gameState.lastBuyFillDay = null;
    gameState.returnPpm = r.returnPpm;
    gameState.returnPct = r.returnPct;
    return gameState;
  }

  gameState.position = r.rawPosition;
  gameState.costBasis = r.costBasis || 0;
  gameState.lastBuyFillDay = r.buyFillDay;
  gameState.returnPpm = null;
  gameState.returnPct = null;

  // After N decisions, UI shows day N+1 (capped at 30). MTM at that close.
  let equity = r.closedMultiple;
  const actionCount =
    typeof actionsLength === 'number' ? actionsLength : gameState.actions.length;
  if (r.rawPosition !== 'empty' && r.buyPrice > 0 && bars) {
    const asOfDay = Math.min(actionCount + 1, 30);
    const mark = bars[asOfDay - 1];
    if (mark) equity = r.closedMultiple * (mark.close / r.buyPrice);
  }
  gameState.totalReturn = equity;
  return gameState;
}

/** Clear settlement-share rank meta (result screen). */
export function clearShareMeta() {
  gameState.shareRank = null;
  gameState.shareBoardTotal = null;
  gameState.shareBeatPct = null;
  return gameState;
}

/** Set settlement-share rank meta after leaderboard lookup. */
export function setShareMeta({ rank = null, boardTotal = null, beatPct = null } = {}) {
  gameState.shareRank = rank;
  gameState.shareBoardTotal = boardTotal;
  gameState.shareBeatPct = beatPct;
  return gameState;
}

/** Snapshot of session fields (shallow). Useful for tests / diagnostics. */
export function snapshotSession() {
  const out = {};
  for (const key of SESSION_KEYS) {
    out[key] = gameState[key];
  }
  return out;
}
