import { config } from "../config.js";
import { PVP_RATING_VERSION } from "../../../../shared/pvpRating.js";

export const PVP_VERSION = "pvp-v1";
export const ECONOMY_VERSION = "pvp-eco-v1";
export { PVP_RATING_VERSION };

export const READY_MS = 10_000;
export const CHALLENGE_MS = 20_000;
export const REVEAL_GAP_MS = 1_000;
export const MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
export const MIN_CLASSIC_GAMES = 3;
export const PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

/** These endings do not consume the 24h same-opponent slot. */
export const SYSTEM_VOID_REASONS = new Set([
  "boot_recovery",
  "system_stall",
  "system_restart",
  "mtm_mismatch",
]);

export function currentEconomy(now) {
  return {
    economyVersion: ECONOMY_VERSION,
    entryCost: config.pvpEntryCost,
    winReward: config.pvpWinReward,
    dailyRewardCap: config.pvpDailyRewardCap,
    pairLimit24h: config.pvpPairLimit24h,
    dayMs: config.pvpDaySeconds * 1000,
    capturedAt: now,
  };
}

export function maxActiveMatches() {
  return config.pvpMaxActiveMatches;
}
