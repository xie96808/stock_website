/**
 * Game play use-case — local action / resume / settle orchestration (no DOM).
 *
 * Ownership (Wave C · C2 slice 1):
 * - Pure guards + shared-engine / puzzle-engine replay + session patches.
 * - Cloud finish request body + response→session patch (HTTP/retry stay in game-sync).
 * - View (`game.js` / `result.js`) calls these then paints HUD / chart / result chrome.
 */

import {
  getSession,
  patchSession,
  applyEngineResult,
} from './game-session.js';
import { replayGame, settleGame } from '../shared/engine.js';
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
  if (session.rewindBusy) return { ok: false, errorZh: '忙碌中' };
  const gameDays = sessionGameDays(session);
  if (session.currentDay >= gameDays) return { ok: false, errorZh: '已到结算日' };
  if (action !== 'buy' && action !== 'sell' && action !== 'hold') {
    return { ok: false, errorZh: '非法操作' };
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
  const actions = Array.isArray(state.actions) ? state.actions.slice() : [];
  const r = replayGame({
    fillMode: session.fillMode,
    bars,
    actions,
    finish: false,
  });
  if (!r.ok) return { ok: false };
  patchSession({
    actions,
    pendingAction: null,
    revision: state.revision ?? session.revision,
    undoCount: state.undoCount ?? session.undoCount,
    assistClass: state.assistClass ?? session.assistClass,
    protocolVersion: state.protocolVersion || session.protocolVersion,
    currentDay: Math.min(actions.length + 1, sessionGameDays(session)),
  });
  applyEngineResult(r, { finished: false, bars });
  return { ok: true };
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
