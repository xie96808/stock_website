/**
 * Game play use-case — start / action / resume / settle / rewind / finish orchestration (no DOM).
 *
 * Ownership (Wave C · C2 complete):
 * - Seed (puzzle / window DTO / pack / local practice), guards, engine replay, session patches.
 * - Rewind eligibility + apply server rewind state (modal/confirm stay in view).
 * - Cloud finish request body + response→session patch; settle→persist hook for result view.
 * - HTTP/retry stay in game-sync; save-status chrome is injected there.
 * - View (`game.js` / `result.js`) calls these then paints HUD / chart / result chrome.
 */

import {
  getSession,
  patchSession,
  resetSession,
  applyEngineResult,
} from './game-session.js';
import { hasGameWindowDto, seedClassicFromWindow } from './game-window-seed.js';
import { replayGame, settleGame } from '../shared/engine.js';
import { oneshotAmmoFromActions } from '../shared/oneshot.js';
export { oneshotAmmoFromActions };
import {
  replayPuzzle,
  settlePuzzle,
  puzzleActionErrorZh,
} from '../shared/puzzleEngine.js';

export function sessionGameDays(session = getSession()) {
  return session.gameDays || 30;
}

export function isPuzzleSession(session = getSession()) {
  return session.gameKind === 'puzzle';
}

export function puzzlePositionFromState(qty, decisionDay, buyFillDay, firstSellableDay) {
  if (!(qty > 0)) return 'empty';
  const fillDayIfSell = decisionDay + 1; // next_open
  if (decisionDay < firstSellableDay) return 'locked';
  if (buyFillDay != null && fillDayIfSell <= buyFillDay) return 'locked';
  return 'holding';
}

/** Apply puzzle engine mid/finish result onto the session (no DOM). */
export function applyPuzzleEngineResult(r, { finished = false, bars = null, session = getSession() } = {}) {
  const gameDays = sessionGameDays(session);
  const init = session.initialState || {};
  const firstSellable = Number(session.firstSellableDay || init.firstSellableDay || 1);
  const trades = (r.trades || []).map((t) => ({
    type: t.type,
    day: t.day,
    price: t.price,
    return: t.return != null ? t.return : null,
  }));
  const tradeGains = trades
    .filter((t) => t.type === 'sell' && t.return != null)
    .map((t) => (t.return - 1) * 100);
  let holdingDays = 0;
  for (const t of trades) {
    if (t.type === 'buy') holdingDays = 0;
    // approximate; engine owns truth on settle
  }
  if (finished) {
    patchSession({
      tradeHistory: trades,
      valuation: r.valuation,
      tradeGains,
      holdingDays: r.holdingDays != null ? r.holdingDays : holdingDays,
      ruleVersion: r.ruleVersion,
      totalReturn: r.takeoverNav > 0 ? r.finalEquity / r.takeoverNav : 1,
      position: 'empty',
      costBasis: 0,
      lastBuyFillDay: null,
      returnPpm: r.returnPpm,
      returnPct: r.returnPct,
      takeoverNav: r.takeoverNav,
    });
    return getSession();
  }
  const actionCount = session.actions.length;
  const asOfDay = Math.min(Math.max(actionCount + 1, 1), gameDays);
  const mark = bars && bars[asOfDay - 1] ? bars[asOfDay - 1].close : null;
  const equity = mark != null ? r.cash + r.qty * mark : r.finalEquity;
  const decisionDay = Math.min(actionCount + 1, gameDays);
  patchSession({
    tradeHistory: trades,
    valuation: null,
    tradeGains,
    holdingDays,
    ruleVersion: r.ruleVersion,
    position: puzzlePositionFromState(r.qty, decisionDay, r.buyFillDay, firstSellable),
    costBasis: r.qty > 0 ? r.cost || 0 : 0,
    lastBuyFillDay: r.buyFillDay,
    totalReturn: r.takeoverNav > 0 ? equity / r.takeoverNav : 1,
    returnPpm: null,
    returnPct: null,
    takeoverNav: r.takeoverNav,
  });
  return getSession();
}

/**
 * Client-side illegal-action guards (puzzle often starts long).
 * @returns {{ ok: true } | { ok: false, errorZh: string }}
 */
export function validatePlayAction(session, action) {
  if (!session) return { ok: false, errorZh: '无对局' };
  if (session.rewindBusy || session.decisionBusy) return { ok: false, errorZh: '忙碌中' };
  const gameDays = sessionGameDays(session);
  if (session.currentDay >= gameDays) return { ok: false, errorZh: '已到结算日' };
  if (action !== 'buy' && action !== 'sell' && action !== 'hold') {
    return { ok: false, errorZh: '非法操作' };
  }
  if (session.gameKind === 'oneshot') {
    const ammo = oneshotAmmoFromActions(session.actions, session.modifiers);
    if (action === 'buy' && ammo.buysLeft <= 0) {
      return { ok: false, errorZh: '一把梭买入次数已用完' };
    }
    if (action === 'sell' && ammo.sellsLeft <= 0) {
      return { ok: false, errorZh: '一把梭卖出次数已用完' };
    }
  }
  if (action === 'buy' && session.position !== 'empty') {
    return { ok: false, errorZh: '已有持仓，不能再买入' };
  }
  if (action === 'sell') {
    if (session.position === 'empty') {
      return { ok: false, errorZh: '空仓无法卖出' };
    }
    if (isPuzzleSession(session) && session.currentDay < (session.firstSellableDay || 1)) {
      return { ok: false, errorZh: '尚未到可卖日（T+1）' };
    }
    if (session.position === 'locked') {
      return { ok: false, errorZh: '受 T+1 限制，今日不可卖出' };
    }
  }
  return { ok: true };
}

/**
 * Replay one local decision onto the session (classic or puzzle). No DOM / toast.
 * @returns {{ ok: true } | { ok: false, errorZh?: string, silent?: boolean }}
 */
export function applyLocalDecision(action, { bars, session = getSession() } = {}) {
  const gameDays = sessionGameDays(session);
  if (!Array.isArray(bars) || bars.length < gameDays) {
    return { ok: false, silent: true };
  }
  const nextActions = session.actions.concat(action);
  if (isPuzzleSession(session)) {
    const r = replayPuzzle({
      fillMode: session.fillMode,
      bars,
      actions: nextActions,
      finish: false,
      initialState: session.initialState,
      maxOrders: session.maxOrders,
    });
    if (!r.ok) {
      return { ok: false, errorZh: puzzleActionErrorZh(r.message) };
    }
    patchSession({ actions: nextActions, pendingAction: null });
    applyPuzzleEngineResult(r, { finished: false, bars, session: getSession() });
    patchSession({ currentDay: Math.min(nextActions.length + 1, gameDays) });
  } else {
    const r = replayGame({
      fillMode: session.fillMode,
      bars,
      actions: nextActions,
      finish: false,
    });
    if (!r.ok) {
      return {
        ok: false,
        errorZh: puzzleActionErrorZh(r.message) || r.message || '操作不合法',
      };
    }
    patchSession({ actions: nextActions, pendingAction: null });
    applyEngineResult(r, { finished: false, bars });
    patchSession({ currentDay: nextActions.length + 1 });
  }
  return { ok: true };
}

/**
 * Apply authoritative server state (event-v1 decision / rewind) onto classic session.
 * No DOM. Puzzle does not use this path today.
 */
export function applyServerDecisionState(state, { bars, session = getSession() } = {}) {
  if (!state || typeof state !== 'object') return { ok: false };
  const actions = Array.isArray(state.actions) ? state.actions.slice() : [];
  const meta = {
    pendingAction: null,
    revision: state.revision ?? session.revision ?? 0,
    undoCount: state.undoCount ?? session.undoCount ?? 0,
    assistClass: state.assistClass ?? session.assistClass,
    protocolVersion: state.protocolVersion || session.protocolVersion,
  };

  // Empty canonical actions = decision day 1 (create / rewind-to-start).
  // replayGame rejects length 0; do not leave revision stale after a successful server write.
  if (actions.length === 0) {
    patchSession({
      ...meta,
      actions: [],
      currentDay: 1,
      tradeHistory: [],
      valuation: null,
      tradeGains: [],
      holdingDays: 0,
      position: 'empty',
      costBasis: 0,
      lastBuyFillDay: null,
      totalReturn: 1,
      returnPpm: null,
      returnPct: null,
    });
    return { ok: true };
  }

  const r = replayGame({
    fillMode: session.fillMode,
    bars,
    actions,
    finish: false,
  });
  if (!r.ok) return { ok: false, engine: r };
  patchSession({
    ...meta,
    actions,
    currentDay: Math.min(actions.length + 1, sessionGameDays(session)),
  });
  applyEngineResult(r, { finished: false, bars });
  return { ok: true };
}

/** True when an HTTP/API error is a revision conflict (409 REVISION_CONFLICT). */
export function isRevisionConflictError(err) {
  if (!err) return false;
  return err.code === 'REVISION_CONFLICT' || err.status === 409 && String(err.code || '').includes('REVISION');
}

/**
 * event-v1 decision sync with one-shot recovery on revision conflict.
 * Inject HTTP adapters so tests stay free of fetch/DOM.
 *
 * @returns {Promise<{
 *   ok: true,
 *   recovered?: boolean,
 *   state?: object
 * } | {
 *   ok: false,
 *   error: Error,
 *   recovered?: boolean
 * }>}
 */
export async function syncEventV1Decision(
  action,
  {
    expectedRevision,
    bars,
    session = getSession(),
    appendDecision,
    fetchState,
  } = {}
) {
  if (typeof appendDecision !== 'function') {
    throw new Error('syncEventV1Decision requires appendDecision');
  }
  if (typeof fetchState !== 'function') {
    throw new Error('syncEventV1Decision requires fetchState');
  }
  const gameId = session.cloudGameId;
  if (!gameId) {
    return { ok: false, error: new Error('无云端对局') };
  }
  const rev =
    expectedRevision != null ? expectedRevision : session.revision ?? 0;

  try {
    const state = await appendDecision(action, rev);
    const applied = applyServerDecisionState(state, { bars, session: getSession() });
    if (applied.ok) return { ok: true, state };
    // Server accepted the write but local apply failed — pull authoritative state once.
    const fresh = await fetchState(gameId);
    const recovered = applyServerDecisionState(fresh, { bars, session: getSession() });
    if (recovered.ok) return { ok: true, recovered: true, state: fresh };
    return {
      ok: false,
      error: new Error('决策已写入但本地状态无法应用，请刷新页面'),
      recovered: false,
    };
  } catch (err) {
    if (!isRevisionConflictError(err)) {
      return { ok: false, error: err };
    }
    try {
      const fresh = await fetchState(gameId);
      const recovered = applyServerDecisionState(fresh, { bars, session: getSession() });
      if (recovered.ok) {
        return { ok: false, recovered: true, error: err, state: fresh };
      }
      return { ok: false, recovered: false, error: err };
    } catch (fetchErr) {
      return { ok: false, recovered: false, error: err, fetchError: fetchErr };
    }
  }
}

/**
 * Resume mid-game actions onto the current seed (cloud draft). No DOM.
 * Invalid drafts → { ok: false } so the view can stay on day 1.
 */
export function resumeLocalActions(actions, { bars, session = getSession() } = {}) {
  if (!Array.isArray(actions) || !actions.length) return { ok: false, empty: true };
  const gameDays = sessionGameDays(session);
  const decisionDays = gameDays - 1;
  if (!Array.isArray(bars) || bars.length < gameDays) {
    return { ok: false, silent: true };
  }
  const clipped = actions.slice(0, decisionDays);
  if (isPuzzleSession(session)) {
    const r = replayPuzzle({
      fillMode: session.fillMode,
      bars,
      actions: clipped,
      finish: false,
      initialState: session.initialState,
      maxOrders: session.maxOrders,
    });
    if (!r.ok) return { ok: false, engine: r };
    patchSession({ actions: clipped.slice() });
    applyPuzzleEngineResult(r, { finished: false, bars, session: getSession() });
    patchSession({ currentDay: Math.min(clipped.length + 1, gameDays) });
  } else {
    const r = replayGame({
      fillMode: session.fillMode,
      bars,
      actions: clipped,
      finish: false,
    });
    if (!r.ok) return { ok: false, engine: r };
    patchSession({ actions: clipped.slice() });
    applyEngineResult(r, { finished: false, bars });
    patchSession({ currentDay: Math.min(clipped.length + 1, gameDays) });
  }
  return { ok: true };
}

/**
 * Last-day settle via shared / puzzle engine; patches session finished fields.
 * Does not navigate to result or call cloud finish — view owns that.
 * @returns {{ ok: true } | { ok: false, errorZh?: string, engine?: object, silent?: boolean }}
 */
export function settleLocalSession({ bars, session = getSession() } = {}) {
  const gameDays = sessionGameDays(session);
  const decisionDays = gameDays - 1;
  if (session.currentDay < gameDays || session.actions.length !== decisionDays) {
    return { ok: false, silent: true };
  }
  if (!Array.isArray(bars) || bars.length < gameDays) {
    return { ok: false, silent: true };
  }
  if (isPuzzleSession(session)) {
    const r = settlePuzzle({
      fillMode: session.fillMode,
      bars,
      actions: session.actions,
      initialState: session.initialState,
      maxOrders: session.maxOrders,
    });
    if (!r.ok) {
      return { ok: false, errorZh: puzzleActionErrorZh(r.message), engine: r };
    }
    applyPuzzleEngineResult(r, { finished: true, bars, session });
    return { ok: true };
  }
  const r = settleGame({
    fillMode: session.fillMode,
    bars,
    actions: session.actions,
  });
  if (!r.ok) {
    return { ok: false, engine: r };
  }
  applyEngineResult(r, { finished: true, bars });
  return { ok: true };
}

function actionsPayload(actions) {
  return (actions || []).map((action, i) => ({ day: i + 1, action }));
}

/**
 * Pure cloud finish request shaping (HTTP stays in game-sync).
 * @returns {{ isPuzzle: boolean, isEventV1: boolean, body: object }}
 */
export function buildCloudFinishBody(session = getSession()) {
  const isPuzzle = session.gameKind === 'puzzle';
  const isEventV1 = !isPuzzle && session.protocolVersion === 'event-v1';
  const body = isEventV1
    ? { finish: true, expectedRevision: session.revision ?? 0 }
    : { actions: actionsPayload(session.actions), finish: true };
  return { isPuzzle, isEventV1, body };
}

/**
 * Map cloud / puzzle finish response fields onto a session patch bag.
 * Caller applies via patchSession and clears draft.
 */
export function sessionPatchFromCloudFinish(data, { isPuzzle = false } = {}) {
  const savedPatch = { saveStatus: 'saved', saveError: null };
  if (!data || typeof data !== 'object') return savedPatch;
  if (data.returnPpm != null) {
    savedPatch.returnPpm = data.returnPpm;
    savedPatch.returnPct = data.returnPct;
  }
  if (data.assistClass) savedPatch.assistClass = data.assistClass;
  if (data.undoCount != null) savedPatch.undoCount = data.undoCount;
  if (isPuzzle) {
    savedPatch.puzzleResult = data;
    if (data.levelKey) savedPatch.puzzleLevelKey = data.levelKey;
  }
  return savedPatch;
}


// ─── Start / seed (no DOM) ───────────────────────────────────────────────────

/** Classify cloud seed payload for start orchestration. */
export function detectSeedKind(cloud) {
  if (!cloud) return 'local';
  const isPuzzle =
    cloud.gameKind === 'puzzle' ||
    (!cloud.gameKind && Array.isArray(cloud.bars) && cloud.bars.length >= 6 && cloud.bars.length <= 10);
  if (isPuzzle) return 'puzzle';
  if (hasGameWindowDto(cloud)) return 'window';
  return 'pack';
}

/**
 * Seed puzzle session from cloud snapshot bars (+ optional history).
 * Throws if bars/gameDays invalid — same as former game.js helper.
 */
export function seedPuzzleSession(cloud) {
  const bars = Array.isArray(cloud.bars) ? cloud.bars : [];
  const history = Array.isArray(cloud.history) ? cloud.history : [];
  const gameDays = Number.isInteger(cloud.gameDays) ? cloud.gameDays : bars.length;
  const historyDays = Number.isInteger(cloud.historyLength)
    ? cloud.historyLength
    : history.length;
  if (!bars.length || bars.length !== gameDays) {
    throw new Error('残局行情快照无效');
  }
  const init = cloud.initialState || {
    cash: 100000,
    qty: 0,
    cost: 0,
    buyFillDay: null,
    firstSellableDay: 1,
  };
  const takeoverMark = bars[0].open;
  const takeoverNav = Number(init.cash) + Number(init.qty || 0) * takeoverMark;
  const day1Close = bars[0].close;
  const equity0 = Number(init.cash) + Number(init.qty || 0) * day1Close;
  const qty = Number(init.qty) || 0;
  const firstSellable = Number(init.firstSellableDay) || 1;
  let position = 'empty';
  if (qty > 0) {
    position = firstSellable > 1 ? 'locked' : 'holding';
  }
  const currentStock = {
    code: cloud.stockCode || 'PUZZLE',
    name: cloud.stockName || '残局挑战',
    kline: history.concat(bars),
  };
  patchSession({
    cloudMode: true,
    cloudGameId: cloud.gameId,
    datasetVersion: cloud.datasetVersion || null,
    ruleVersion: cloud.ruleVersion || 'puzzle-mtm-v1',
    fillMode: cloud.fillMode || 'next_open',
    protocolVersion: cloud.protocolVersion || 'legacy-batch',
    gameKind: 'puzzle',
    gameDays,
    currentDay: 1,
    actions: [],
    tradeHistory: [],
    initialState: init,
    firstSellableDay: firstSellable,
    maxOrders: cloud.maxOrders ?? null,
    puzzleLevelKey: cloud.levelKey || cloud.puzzleLevelKey || null,
    puzzleGoals: cloud.goals || null,
    puzzleOpenStateHint: cloud.openStateHint || null,
    puzzleTeachingBrief: cloud.teachingBrief || null,
    puzzleTheme: cloud.theme || null,
    puzzleTitle: cloud.title || null,
    puzzleResult: null,
    takeoverNav,
    revision: cloud.revision ?? 0,
    undoCount: 0,
    assistClass: cloud.assistClass || 'legacy',
    currentStock,
    historyLength: historyDays,
    gameKline: history.concat(bars),
    position,
    costBasis: qty > 0 ? Number(init.cost) || 0 : 0,
    lastBuyFillDay: init.buyFillDay != null ? init.buyFillDay : null,
    totalReturn: takeoverNav > 0 ? equity0 / takeoverNav : 1,
    practiceOnly: false,
  });
  return getSession();
}

/**
 * Classic cloud seed from catalog pack indices (pre-R5 / no window DTO).
 * @returns {boolean} true if seeded from cloud stockIndex
 */
export function seedClassicFromPack(cloud, catalog) {
  const gameDays = 30;
  if (!(cloud && Number.isInteger(cloud.stockIndex) && catalog[cloud.stockIndex])) {
    return false;
  }
  const currentStock = catalog[cloud.stockIndex];
  const historyDays = Number.isInteger(cloud.historyLength)
    ? cloud.historyLength
    : Math.min(30, currentStock.kline.length - gameDays);
  const gameStartIndex = Number.isInteger(cloud.windowStartIndex)
    ? cloud.windowStartIndex
    : historyDays;
  patchSession({
    cloudMode: true,
    cloudGameId: cloud.gameId,
    datasetVersion: cloud.datasetVersion || null,
    ruleVersion: cloud.ruleVersion || getSession().ruleVersion,
    fillMode: cloud.fillMode || getSession().fillMode,
    protocolVersion: cloud.protocolVersion || null,
    gameKind: cloud.gameKind || null,
    modifiers: cloud.modifiers || null,
    gameDays: 30,
    revision: cloud.revision ?? 0,
    undoCount: cloud.undoCount ?? 0,
    assistClass: cloud.assistClass || null,
    currentStock,
    historyLength: historyDays,
    gameKline: currentStock.kline.slice(
      gameStartIndex - historyDays,
      gameStartIndex + gameDays
    ),
  });
  return true;
}

/**
 * Local practice: random stock + window (30 game days).
 * @param {object[]} catalog
 * @param {{ random?: () => number }} [opts] — `random` in [0,1) for tests
 */
export function seedLocalPractice(catalog, { random = Math.random } = {}) {
  const gameDays = 30;
  if (!catalog || !catalog.length) {
    throw new Error('股票资源未就绪');
  }
  const stockIndex = Math.floor(random() * catalog.length);
  const currentStock = catalog[stockIndex];
  const klineLen = currentStock.kline.length;
  const historyDays = Math.min(30, klineLen - gameDays);
  const minStart = historyDays;
  const maxStart = klineLen - gameDays; // inclusive
  const span = Math.max(1, maxStart - minStart + 1);
  const gameStartIndex = minStart + Math.floor(random() * span);
  patchSession({
    currentStock,
    historyLength: historyDays,
    gameDays: 30,
    gameKline: currentStock.kline.slice(
      gameStartIndex - historyDays,
      gameStartIndex + gameDays
    ),
    practiceOnly: true,
  });
  return getSession();
}

/**
 * Reset + seed session for a new run. Chart / screen routing stay in the view.
 * @returns {{ kind: 'puzzle'|'window'|'pack'|'local', session: object }}
 */
export function prepareSessionSeed({
  cloud = null,
  catalog = [],
  practiceOnly = false,
  fillMode = 'next_open',
  random = Math.random,
} = {}) {
  resetSession({
    practiceOnly: !!practiceOnly,
    fillMode,
  });
  const kind = detectSeedKind(cloud);
  if (kind === 'puzzle') {
    seedPuzzleSession(cloud);
    return { kind: 'puzzle', session: getSession() };
  }
  if (kind === 'window') {
    seedClassicFromWindow(cloud);
    return { kind: 'window', session: getSession() };
  }
  if (cloud && seedClassicFromPack(cloud, catalog)) {
    return { kind: 'pack', session: getSession() };
  }
  seedLocalPractice(catalog, { random });
  return { kind: 'local', session: getSession() };
}

// ─── Rewind (eligibility / apply; modal stays in view) ───────────────────────

const REWIND_COST_DEFAULT = 50;

/**
 * Pure eligibility for F03 rewind button / confirm entry.
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluateRewindEligibility(session = getSession(), features = {}) {
  if (!features || !features.gameRewind) {
    return { eligible: false, reason: 'flag_off' };
  }
  if (!session?.cloudMode) return { eligible: false, reason: 'not_cloud' };
  if (session.gameKind === 'daily') return { eligible: false, reason: 'daily' };
  if (session.gameKind === 'puzzle') return { eligible: false, reason: 'puzzle' };
  if (session.gameKind === 'oneshot') return { eligible: false, reason: 'oneshot' };
  if (session.gameKind === 'survival') return { eligible: false, reason: 'survival' };
  if (session.protocolVersion !== 'event-v1') {
    return { eligible: false, reason: 'protocol' };
  }
  if ((session.undoCount ?? 0) >= 1) return { eligible: false, reason: 'used' };
  if (session.rewindBusy) return { eligible: false, reason: 'busy' };
  const actions = session.actions;
  if (!Array.isArray(actions) || actions.length < 1) {
    return { eligible: false, reason: 'no_actions' };
  }
  const maxDecisions = sessionGameDays(session) - 1;
  if (actions.length > maxDecisions) {
    return { eligible: false, reason: 'past_window' };
  }
  return { eligible: true };
}

/**
 * Preview model for rewind confirm modal (no DOM).
 * @returns {{ cost: number, balance: number, after: number, targetDay: number, canAfford: boolean }}
 */
export function buildRewindPreview(session = getSession(), { balance = 0, cost = REWIND_COST_DEFAULT } = {}) {
  const bal = Number(balance) || 0;
  const c = Number(cost) || REWIND_COST_DEFAULT;
  const after = bal - c;
  const targetDay = Array.isArray(session.actions) ? session.actions.length : 0;
  return {
    cost: c,
    balance: bal,
    after,
    targetDay,
    canAfford: after >= 0,
  };
}

/**
 * Apply event-v1 rewind response onto classic session (no DOM / toast / balance chrome).
 * @returns {{ ok: true } | { ok: false }}
 */
export function applyRewindServerResult(data, { bars, session = getSession() } = {}) {
  if (!data || typeof data !== 'object') return { ok: false };
  const applied = applyServerDecisionState(data, { bars, session });
  if (!applied.ok) return { ok: false };
  patchSession({
    undoCount: data.undoCount ?? 1,
    assistClass: data.assistClass || 'undo',
    revision: data.revision ?? getSession().revision,
  });
  return { ok: true, balanceAfter: data.balanceAfter };
}

// ─── Create / abandon / settle→persist (orchestration; HTTP injected) ────────

/** Whether the settled session should call cloud finish. */
export function shouldPersistCloudSettle(session = getSession()) {
  return !!(session && session.cloudMode && session.cloudGameId);
}

/**
 * Single settle→persist entry for the result view boundary.
 * Inject `finishCloud` (default: game-sync.finishCloudGame) so tests stay DOM-free.
 * @returns {Promise<null|{ data: object, status: number }>}
 */
export async function persistSettledCloudGame({
  session = getSession(),
  finishCloud,
} = {}) {
  if (!shouldPersistCloudSettle(session)) return null;
  if (typeof finishCloud !== 'function') {
    throw new Error('persistSettledCloudGame requires finishCloud');
  }
  return finishCloud();
}

/**
 * Abandon orchestration: HTTP abandon + clear local draft for that game.
 * Inject adapters so game-sync stays the HTTP owner.
 */
export async function abandonCloudSession(gameId, { abandonHttp, clearDraft } = {}) {
  if (!gameId) return null;
  if (typeof abandonHttp !== 'function') {
    throw new Error('abandonCloudSession requires abandonHttp');
  }
  await abandonHttp(gameId);
  if (typeof clearDraft === 'function') clearDraft(gameId);
  return gameId;
}

/**
 * Create cloud game then clear stale drafts (start-flow / use-case entry).
 */
export async function createCloudSession(fillMode, { createHttp, clearDraft, gameKind } = {}) {
  if (typeof createHttp !== 'function') {
    throw new Error('createCloudSession requires createHttp');
  }
  const cloud = gameKind
    ? await createHttp(fillMode, { gameKind })
    : await createHttp(fillMode);
  if (typeof clearDraft === 'function') clearDraft();
  return cloud;
}
