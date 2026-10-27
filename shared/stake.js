/**
 * 韭币局 rules, shared by the server (create / settle) and the client (stake picker / HUD / result copy).
 * The game itself is the classic 30-day simulation; only the money around it differs:
 *   stake   10–200 韭币 (whole coins), escrowed when the game is created
 *   buys    at most 2 (an opening buy plus one top-up); sells follow the position
 *   payout  stake + profit − fee, where profit = stake × return and fee = 10% of a positive profit
 * Nothing here changes the settlement maths (sim30-mtm-v1): it only turns its return into coins.
 */

export const STAKE_MIN = 10;
export const STAKE_MAX = 200;
export const STAKE_MAX_BUYS = 2;
export const STAKE_FEE_RATE = 0.1;
/** Quick picks shown in the stake sheet. */
export const STAKE_PRESETS = Object.freeze([10, 50, 100, 200]);

export function isValidStake(n) {
  return Number.isInteger(n) && n >= STAKE_MIN && n <= STAKE_MAX;
}

/** Clamp a typed / dragged value into the allowed range (NaN → min). */
export function clampStake(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return STAKE_MIN;
  return Math.min(STAKE_MAX, Math.max(STAKE_MIN, v));
}

export function stakeModifiers(stake) {
  return { maxBuys: STAKE_MAX_BUYS, stake };
}

/** Half-away-from-zero rounding so a +x and a −x return move the same number of coins. */
function roundCoins(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * @param {number} stake whole coins staked
 * @param {number} returnPpm settled return in parts-per-million (e.g. 150000 = +15%)
 * @returns {{stake:number, profit:number, fee:number, payout:number, net:number}}
 *   profit is before the fee; net = payout − stake (what the balance moves by over the whole game).
 */
export function stakeSettlement(stake, returnPpm) {
  const profit = roundCoins((stake * returnPpm) / 1_000_000);
  const fee = profit > 0 ? Math.floor(profit * STAKE_FEE_RATE) : 0;
  const payout = Math.max(0, stake + profit - fee);
  return { stake, profit, fee, payout, net: payout - stake };
}

/** Buys already used in an action list (strings or {action}). */
export function countBuys(actions) {
  let n = 0;
  for (const a of actions || []) if ((typeof a === "string" ? a : a?.action) === "buy") n++;
  return n;
}

/**
 * Whether `next` may be appended after `prev` in a staked game.
 * @returns {{ok:true}|{ok:false,code:string,message:string,details:object}}
 */
export function checkStakeNextAction(prev, next) {
  if (next === "buy" && countBuys(prev) >= STAKE_MAX_BUYS) {
    return {
      ok: false,
      code: "STAKE_BUY_LIMIT",
      message: `韭币局最多买入 ${STAKE_MAX_BUYS} 次（共两次买入机会）`,
      details: { maxBuys: STAKE_MAX_BUYS, used: countBuys(prev) },
    };
  }
  return { ok: true };
}

/** Whole-list check for the legacy batch finish. */
export function checkStakeActionList(actions) {
  const used = countBuys(actions);
  if (used > STAKE_MAX_BUYS) {
    return {
      ok: false,
      code: "STAKE_BUY_LIMIT",
      message: `韭币局最多买入 ${STAKE_MAX_BUYS} 次（共两次买入机会）`,
      details: { maxBuys: STAKE_MAX_BUYS, used },
    };
  }
  return { ok: true };
}
