/**
 * Oneshot (一把梭) modifiers + order-limit helpers.
 * Shared by server (append/finish) and client (HUD / button guards).
 * Does not change sim30-mtm-v1 math — only counts buy/sell vs modifiers.
 */

import { ONESHOT_MODIFIERS } from './protocol.js';

export { ONESHOT_MODIFIERS };

export function parseModifiers(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

export function oneshotLimits(modifiers) {
  const m = parseModifiers(modifiers) || ONESHOT_MODIFIERS;
  const maxBuys = Number.isInteger(m.maxBuys) ? m.maxBuys : ONESHOT_MODIFIERS.maxBuys;
  const maxSells = Number.isInteger(m.maxSells) ? m.maxSells : ONESHOT_MODIFIERS.maxSells;
  return { maxBuys, maxSells };
}

export function countSideActions(actions) {
  let buys = 0;
  let sells = 0;
  if (!Array.isArray(actions)) return { buys, sells };
  for (const a of actions) {
    if (a === 'buy') buys += 1;
    else if (a === 'sell') sells += 1;
  }
  return { buys, sells };
}

export function oneshotAmmoFromActions(actions, modifiers) {
  const { maxBuys, maxSells } = oneshotLimits(modifiers);
  const { buys, sells } = countSideActions(actions);
  return {
    buysLeft: Math.max(0, maxBuys - buys),
    sellsLeft: Math.max(0, maxSells - sells),
    maxBuys,
    maxSells,
    buys,
    sells,
  };
}

export function checkOneshotNextAction(prevActions, nextAction, modifiers) {
  const ammo = oneshotAmmoFromActions(prevActions, modifiers);
  if (nextAction === 'buy' && ammo.buysLeft <= 0) {
    return {
      ok: false,
      code: 'ORDER_LIMIT',
      message: '一把梭买入次数已用完',
      details: { side: 'buy', maxBuys: ammo.maxBuys, used: ammo.buys },
    };
  }
  if (nextAction === 'sell' && ammo.sellsLeft <= 0) {
    return {
      ok: false,
      code: 'ORDER_LIMIT',
      message: '一把梭卖出次数已用完',
      details: { side: 'sell', maxSells: ammo.maxSells, used: ammo.sells },
    };
  }
  return { ok: true };
}

export function checkOneshotActionList(actions, modifiers) {
  const { maxBuys, maxSells } = oneshotLimits(modifiers);
  const { buys, sells } = countSideActions(actions);
  if (buys > maxBuys) {
    return {
      ok: false,
      code: 'ORDER_LIMIT',
      message: '一把梭买入次数已用完',
      details: { side: 'buy', buys, maxBuys },
    };
  }
  if (sells > maxSells) {
    return {
      ok: false,
      code: 'ORDER_LIMIT',
      message: '一把梭卖出次数已用完',
      details: { side: 'sell', sells, maxSells },
    };
  }
  return { ok: true };
}

export function oneshotModifiersJson() {
  return JSON.stringify(ONESHOT_MODIFIERS);
}
