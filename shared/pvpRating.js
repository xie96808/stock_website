/**
 * PvP Elo v1. K is fixed. The 700 floor can make stored deltas non-zero-sum;
 * callers persist actualDelta, not the pre-clamp pair.
 */
import { roundHalfUp } from './engine.js';

export const PVP_RATING_VERSION = 'pvp-elo-v1';
export const PVP_RATING_K = 32;
export const PVP_RATING_FLOOR = 700;
export const PVP_RATING_INITIAL = 1000;
export const PVP_PLACEMENT_GAMES = 10;

const GROUPS = ['韭菜', '散户', '股民老手', '游资', '庄家'];
const DUAN = ['一段', '二段', '三段'];

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/** Unclamped delta for A. B's unclamped delta is the negation. */
export function rawDelta(ratingA, ratingB, scoreA) {
  return roundHalfUp(PVP_RATING_K * (scoreA - expectedScore(ratingA, ratingB)));
}

/**
 * @param {{ ratingA: number, ratingB: number, scoreA: 0|0.5|1 }} opts
 */
export function applyPair({ ratingA, ratingB, scoreA }) {
  if (scoreA !== 0 && scoreA !== 0.5 && scoreA !== 1) {
    throw new Error('scoreA must be 0, 0.5, or 1');
  }
  const deltaA = rawDelta(ratingA, ratingB, scoreA);
  const deltaB = -deltaA;
  const afterA = Math.max(PVP_RATING_FLOOR, ratingA + deltaA);
  const afterB = Math.max(PVP_RATING_FLOOR, ratingB + deltaB);
  return {
    ratingVersion: PVP_RATING_VERSION,
    k: PVP_RATING_K,
    deltaA,
    deltaB,
    a: { before: ratingA, after: afterA, actualDelta: afterA - ratingA },
    b: { before: ratingB, after: afterB, actualDelta: afterB - ratingB },
  };
}

export function levelForRating(rating) {
  if (!Number.isFinite(rating)) return 1;
  const raw = Math.floor((rating - PVP_RATING_FLOOR) / 100) + 1;
  return Math.min(15, Math.max(1, raw));
}

/**
 * Display title. `level` is for tests and band math; the product shows `name`, not "N级".
 * @param {number|null} [games] rated games so far. Below 10 is placement, same K.
 */
export function titleForRating(rating, games = null) {
  const level = levelForRating(rating);
  const group = GROUPS[Math.floor((level - 1) / 3)];
  const duan = DUAN[(level - 1) % 3];
  const bandLow = level === 15 ? 2100 : PVP_RATING_FLOOR + (level - 1) * 100;
  const pointsToNext = level === 15 ? null : bandLow + 100 - rating;
  return {
    level,
    name: `${group}${duan}`,
    bandLow,
    bandHigh: level === 15 ? null : bandLow + 99,
    pointsToNext,
    inPlacement: games != null && games < PVP_PLACEMENT_GAMES,
  };
}
