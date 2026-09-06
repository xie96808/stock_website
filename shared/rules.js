/**
 * sim30-mtm-v1 rule metadata (no DOM).
 * Frozen product rules for Stage 1 shared engine.
 */
export const RULE_VERSION = 'sim30-mtm-v1';
export const GAME_DAYS = 30;
export const DECISION_DAYS = 29;
export const INITIAL_CASH = 100000;
export const FILL_MODES = Object.freeze(['next_open', 'same_close']);
export const ACTIONS = Object.freeze(['buy', 'sell', 'hold']);

export const RULE_META = Object.freeze({
  ruleVersion: RULE_VERSION,
  gameDays: GAME_DAYS,
  decisionDays: DECISION_DAYS,
  initialCash: INITIAL_CASH,
  fillModes: FILL_MODES,
  actions: ACTIONS,
  position: 'flat_or_100_long',
  fees: false,
  slippage: false,
  day30: 'finish_settle_valuation_only',
  returnUnit: 'return_ppm',
});
