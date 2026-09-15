/**
 * Survival (活过三十日 / 爆仓生存) helpers.
 * Bust = nav relative to start ≤ −20% (returnPpm ≤ −200000).
 * NOT peak MDD — unit tests lock that distinction.
 */

import { SURVIVAL_MODIFIERS } from './protocol.js';
import { parseModifiers } from './oneshot.js';

export { SURVIVAL_MODIFIERS, parseModifiers };

export function survivalLimits(modifiers) {
  const m = parseModifiers(modifiers) || SURVIVAL_MODIFIERS;
  const bustNavPpm = Number.isFinite(m.bustNavPpm)
    ? Math.trunc(m.bustNavPpm)
    : SURVIVAL_MODIFIERS.bustNavPpm;
  const bustBasis =
    m.bustBasis === 'start_nav' || m.bustBasis === 'peak_nav'
      ? m.bustBasis
      : SURVIVAL_MODIFIERS.bustBasis;
  return { bustNavPpm, bustBasis };
}

/**
 * @param {number} navPpm return vs start NAV in ppm (engine returnPpm)
 * @param {object|string|null} modifiers
 * @returns {{ busted: boolean, navPpm: number, bustNavPpm: number, bustBasis: string }}
 */
export function checkSurvivalBust(navPpm, modifiers) {
  const { bustNavPpm, bustBasis } = survivalLimits(modifiers);
  const ppm = Number.isFinite(navPpm) ? Math.trunc(navPpm) : 0;
  // Phase B: only start_nav is supported. peak_nav must never silently apply.
  const busted = bustBasis === 'start_nav' && ppm <= bustNavPpm;
  return { busted, navPpm: ppm, bustNavPpm, bustBasis };
}

/**
 * HUD float vs start NAV (−20% line). warn when within 5pp of the line or below.
 * @returns {{
 *   navPpm: number,
 *   navPct: number,
 *   bustNavPpm: number,
 *   progress01: number,
 *   warn: boolean,
 *   label: string
 * }}
 */
export function survivalFloatHud(navPpm, modifiers) {
  const { bustNavPpm } = survivalLimits(modifiers);
  const ppm = Number.isFinite(navPpm) ? Math.trunc(navPpm) : 0;
  const navPct = ppm / 10000;
  const bustPct = bustNavPpm / 10000;
  // Map [bustPct .. 0+] onto a 0..1 bar fill from the −20% line toward 0 / profit.
  // Below bust → 0; at 0% → ~0.8; profits clamp to 1.
  const span = Math.max(1e-9, 0 - bustPct);
  const progress01 = Math.max(0, Math.min(1, (navPct - bustPct) / (span * 1.25)));
  const warn = ppm <= bustNavPpm + 50000; // within 5% of start toward the line
  const sign = navPct > 0 ? '+' : '';
  const label = `相对开局 ${sign}${navPct.toFixed(2)}% · 爆仓线 ${bustPct.toFixed(0)}%`;
  return { navPpm: ppm, navPct, bustNavPpm, progress01, warn, label };
}

export function survivalModifiersJson() {
  return JSON.stringify(SURVIVAL_MODIFIERS);
}
