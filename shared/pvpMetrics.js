/**
 * PvP revealed-equity and completed-winner rules.
 * Mid-game mark uses the equity-curve tail. replayGame's unfinished
 * returnPpm stays a single-player engine value and is not the PvP NAV.
 */
import { replayGame, settleGame, roundHalfUp } from './engine.js';
import { buildEquityCurveCash } from './equityCurve.js';
import { DECISION_DAYS, GAME_DAYS, INITIAL_CASH } from './rules.js';

export const PVP_FILL_MODE = 'next_open';

/** Final PvP NAV must equal settleGame. A mismatch aborts the match. */
export function reconcileReturns(curvePpm, settleReturnPpm) {
  if (curvePpm !== settleReturnPpm) {
    return { ok: false, code: 'MTM_MISMATCH', visibleMtmPpm: curvePpm, settleReturnPpm };
  }
  return { ok: true, returnPpm: curvePpm };
}

/**
 * @param {number} resolvedRounds already-resolved decision count, 0..29
 * @returns {{ resolvedRounds: number, round: number|null, revealedBars: number, decisionOpen: boolean }}
 */
export function roundView(resolvedRounds) {
  if (!Number.isInteger(resolvedRounds) || resolvedRounds < 0 || resolvedRounds > DECISION_DAYS) {
    return { ok: false, code: 'BAD_ROUND' };
  }
  const decisionOpen = resolvedRounds < DECISION_DAYS;
  return {
    ok: true,
    resolvedRounds,
    round: decisionOpen ? resolvedRounds + 1 : null,
    revealedBars: resolvedRounds + 1,
    decisionOpen,
    gameDays: GAME_DAYS,
  };
}

/**
 * NAV in ppm after `actions` have all been resolved.
 * k = 0 is flat cash. k = 29 must match settleGame or the caller aborts the match.
 * @returns {{ ok: true, k: number, visibleMtmPpm: number, finalReturnPpm?: number }
 *   | { ok: false, code: string, visibleMtmPpm?: number, settleReturnPpm?: number|null }}
 */
export function visibleMtmPpm({ fillMode = PVP_FILL_MODE, bars, actions } = {}) {
  if (!Array.isArray(actions) || actions.length > DECISION_DAYS) {
    return { ok: false, code: 'BAD_ROUND' };
  }
  const k = actions.length;
  if (k === 0) return { ok: true, k, visibleMtmPpm: 0 };

  let curve;
  try {
    curve = buildEquityCurveCash({
      fillMode,
      bars,
      actions,
      finish: k === DECISION_DAYS,
    });
  } catch {
    return { ok: false, code: 'BAD_MARKET' };
  }
  const ppm = roundHalfUp((curve.at(-1) / INITIAL_CASH - 1) * 1e6);
  if (!Number.isFinite(ppm)) return { ok: false, code: 'BAD_MARKET' };

  if (k === DECISION_DAYS) {
    const settled = settleGame({ fillMode, bars, actions });
    const reconciled = reconcileReturns(ppm, settled.ok ? settled.returnPpm : null);
    if (!reconciled.ok) return reconciled;
    return { ok: true, k, visibleMtmPpm: ppm, finalReturnPpm: ppm };
  }
  return { ok: true, k, visibleMtmPpm: ppm };
}

/**
 * Buttons for the open decision round. Legality is the engine's T+1 rule
 * on resolved actions plus the candidate. A raw `locked` position does not
 * by itself forbid a sell whose fill day is later than the buy fill.
 */
export function actionAvailability({ fillMode = PVP_FILL_MODE, bars, actions } = {}) {
  if (!Array.isArray(actions) || actions.length >= DECISION_DAYS) {
    return { canBuy: false, canSell: false, canHold: false };
  }
  const allowed = (action) => {
    const replay = replayGame({
      fillMode,
      bars,
      actions: [...actions, action],
      finish: false,
    });
    return replay.ok === true;
  };
  return {
    canBuy: allowed('buy'),
    canSell: allowed('sell'),
    canHold: allowed('hold'),
  };
}

/**
 * Completed matches only. Higher return wins; equal return, smaller drawdown wins.
 * @returns {string|number|null} winner user id, or null for a draw
 */
export function decideCompletedWinner(a, b) {
  if (a.returnPpm !== b.returnPpm) return a.returnPpm > b.returnPpm ? a.userId : b.userId;
  if (a.mddPpm !== b.mddPpm) return a.mddPpm < b.mddPpm ? a.userId : b.userId;
  return null;
}
