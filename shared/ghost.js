/**
 * Ghost duel (幽灵对局) — Phase C.
 * Replay yesterday's daily #1 trajectory as a solo opponent (no rooms / WS).
 * Identity (nickname + avatar) is frozen into session modifiers at create time.
 */

import { parseModifiers } from './oneshot.js';
import { INITIAL_CASH } from './rules.js';
import { GAME_KIND_GHOST } from './protocol.js';

export { GAME_KIND_GHOST };

/** Label shown next to ghost identity in HUD / entry. */
export const GHOST_LABEL = '幽灵';

/**
 * @param {unknown} modifiers
 * @returns {object|null} frozen ghost payload from session modifiers
 */
export function ghostPayloadFromModifiers(modifiers) {
  const m = parseModifiers(modifiers);
  const g = m && m.ghost;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  return g;
}

/**
 * Persistent HUD identity — name + avatar required for product.
 * @param {unknown} modifiers
 * @returns {{
 *   nickname: string,
 *   avatarId: number|string|null,
 *   avatarUrl: string|null,
 *   label: string,
 *   returnPpm: number|null,
 *   userId: number|null,
 *   sourceDate: string|null,
 * }|null}
 */
export function ghostIdentityFromModifiers(modifiers) {
  const g = ghostPayloadFromModifiers(modifiers);
  if (!g) return null;
  const nickname = typeof g.nickname === 'string' && g.nickname.trim()
    ? g.nickname.trim()
    : '幽灵选手';
  return {
    nickname,
    avatarId: g.avatarId != null ? g.avatarId : 1,
    avatarUrl: typeof g.avatarUrl === 'string' && g.avatarUrl ? g.avatarUrl : null,
    label: GHOST_LABEL,
    returnPpm: Number.isFinite(Number(g.returnPpm)) ? Number(g.returnPpm) : null,
    userId: g.userId != null ? g.userId : null,
    sourceDate: typeof g.sourceDate === 'string' ? g.sourceDate : null,
  };
}

/** Preset avatar path when avatarUrl is absent (matches day-board / leaderboard). */
export function ghostPresetAvatarUrl(identity) {
  const n = String(identity?.avatarId || 1).padStart(2, '0');
  return `images/avatars/${n}.png`;
}

export function ghostAvatarSrc(identity) {
  if (!identity) return ghostPresetAvatarUrl(null);
  if (identity.avatarUrl) return identity.avatarUrl;
  return ghostPresetAvatarUrl(identity);
}

/**
 * Ghost return at a decision depth (0 = start, N = after N decisions).
 * Prefer frozen equityCurve; fall back to final returnPpm when fully caught up.
 *
 * @param {object|null} ghostPayload
 * @param {number} decisionCount — player actions.length (0..29)
 * @returns {{ returnPpm: number, equity: number|null, decisionCount: number }|null}
 */
export function ghostReturnAtDecisionCount(ghostPayload, decisionCount) {
  if (!ghostPayload) return null;
  const n = Math.max(0, Math.floor(Number(decisionCount) || 0));
  const curve = ghostPayload.equityCurve;
  if (Array.isArray(curve) && curve.length) {
    const point = curve.find((p) => p && Number(p.day) === n) || curve[Math.min(n, curve.length - 1)];
    if (point && Number.isFinite(Number(point.equity))) {
      const equity = Number(point.equity);
      const returnPpm = Math.round((equity / INITIAL_CASH - 1) * 1e6);
      return { returnPpm, equity, decisionCount: n };
    }
  }
  const actions = Array.isArray(ghostPayload.actions) ? ghostPayload.actions : [];
  if (n === 0) return { returnPpm: 0, equity: INITIAL_CASH, decisionCount: 0 };
  if (n >= actions.length && Number.isFinite(Number(ghostPayload.returnPpm))) {
    return {
      returnPpm: Number(ghostPayload.returnPpm),
      equity: null,
      decisionCount: n,
    };
  }
  return { returnPpm: 0, equity: null, decisionCount: n };
}

/**
 * Format ppm as signed percent string for HUD (e.g. +1.23% / -0.50%).
 * @param {number|null|undefined} returnPpm
 */
export function formatGhostReturnPct(returnPpm) {
  if (!Number.isFinite(Number(returnPpm))) return '—';
  const pct = Number(returnPpm) / 10000;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Chinese label for a ghost day-action. Hold still surfaces as 观望 (never skip).
 * @param {string} action
 * @returns {string}
 */
export function ghostActionLabelZh(action) {
  if (action === 'buy') return '买入';
  if (action === 'sell') return '卖出';
  if (action === 'hold') return '观望';
  return '—';
}

/**
 * Same-day ghost action after the player has committed `decisionCount` decisions.
 * Cadence: player locks day N first, then reveal ghost.actions[N-1] (incl. hold→观望).
 *
 * @param {object|null} ghostPayload
 * @param {number} decisionCount — player actions.length after the commit (0..29)
 * @returns {{ index: number, day: number, action: string, labelZh: string }|null}
 */
export function ghostRevealAfterPlayerDecisions(ghostPayload, decisionCount) {
  const n = Math.max(0, Math.floor(Number(decisionCount) || 0));
  if (n < 1 || !ghostPayload) return null;
  const actions = Array.isArray(ghostPayload.actions) ? ghostPayload.actions : [];
  const index = n - 1;
  if (index < 0 || index >= actions.length) return null;
  const action = actions[index];
  if (action !== 'buy' && action !== 'sell' && action !== 'hold') return null;
  return {
    index,
    day: index + 1,
    action,
    labelZh: ghostActionLabelZh(action),
  };
}

/**
 * All ghost day-actions revealed so far (for trade log / mid-game resume).
 * @param {object|null} ghostPayload
 * @param {number} decisionCount
 * @returns {Array<{ index: number, day: number, action: string, labelZh: string }>}
 */
export function ghostRevealedActions(ghostPayload, decisionCount) {
  const n = Math.max(0, Math.floor(Number(decisionCount) || 0));
  if (n < 1 || !ghostPayload) return [];
  const actions = Array.isArray(ghostPayload.actions) ? ghostPayload.actions : [];
  const out = [];
  for (let i = 0; i < Math.min(n, actions.length); i++) {
    const action = actions[i];
    if (action !== 'buy' && action !== 'sell' && action !== 'hold') continue;
    out.push({
      index: i,
      day: i + 1,
      action,
      labelZh: ghostActionLabelZh(action),
    });
  }
  return out;
}

/**
 * Build modifiers JSON string for a ghost duel session.
 * @param {object} ghost — identity + actions + optional equityCurve
 * @param {{ sourceChallengeId: string, sourceChallengeDate: string }} source
 */
export function ghostModifiersJson(ghost, source) {
  return JSON.stringify({
    ghost: {
      userId: ghost.userId,
      gameId: ghost.gameId,
      nickname: ghost.nickname,
      avatarId: ghost.avatarId,
      avatarUrl: ghost.avatarUrl || null,
      returnPpm: ghost.returnPpm,
      mddPpm: ghost.mddPpm ?? null,
      actions: ghost.actions,
      equityCurve: ghost.equityCurve || null,
      sourceDate: source.sourceChallengeDate,
    },
    sourceChallengeId: source.sourceChallengeId,
    sourceChallengeDate: source.sourceChallengeDate,
  });
}
