/**
 * 韭币局 copy + maths for the client (no DOM). Rules come from shared/stake.js so what the player is told
 * is exactly what the server pays.
 */
import {
  STAKE_MIN,
  STAKE_MAX,
  STAKE_MAX_BUYS,
  STAKE_PRESETS,
  clampStake,
  stakeSettlement,
  countBuys,
} from '../shared/stake.js';

export { STAKE_MIN, STAKE_MAX, STAKE_MAX_BUYS, STAKE_PRESETS, clampStake, stakeSettlement, countBuys };

/** Presets the player can afford, always keeping the minimum so the sheet is never empty. */
export function affordablePresets(balance) {
  const b = balance == null ? NaN : Number(balance);
  const list = STAKE_PRESETS.filter((n) => !Number.isFinite(b) || n <= b);
  return list.length ? list : [STAKE_MIN];
}

/** Can this player put `stake` on the table right now? */
export function stakeAffordable(stake, balance) {
  const b = balance == null ? NaN : Number(balance);
  return Number.isFinite(b) ? b >= stake : true;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * 「预期本金加奖金总和」 rows under the picker: what a +20% / −20% game would pay out in total
 * (stake + profit − fee), i.e. the coins that land back in the balance.
 */
export function stakePayoutRows(stake) {
  const s = clampStake(stake);
  const up = stakeSettlement(s, 200000);
  const down = stakeSettlement(s, -200000);
  return [
    { label: '股价涨 20%', value: up.payout, tone: 'up' },
    { label: '股价跌 20%', value: down.payout, tone: 'down' },
  ];
}

/** Digits shown on the three reels (10–200 → "010"…"200"); `dim` marks the leading zeros. */
export function reelDigits(stake) {
  const text = String(Math.max(0, Math.min(999, Math.round(Number(stake) || 0)))).padStart(3, '0');
  return text.split('').map((d, i) => ({ digit: Number(d), dim: d === '0' && text.slice(0, i + 1).replace(/0/g, '') === '' && i < 2 }));
}

/** HUD subtitle while playing. */
export function stakeHudSubtitle(stake, actions) {
  const left = Math.max(0, STAKE_MAX_BUYS - countBuys(actions));
  const amount = stake && Number.isFinite(stake.amount) ? stake.amount : null;
  return `${amount == null ? '' : `投入 ${amount} · `}剩余买入 ${left} 次`;
}

export function stakeBuysLeft(actions) {
  return Math.max(0, STAKE_MAX_BUYS - countBuys(actions));
}

/**
 * Result-screen rows for a settled/forfeited stake (server `stake` object).
 * @returns {{rows: Array<{label:string, value:string, tone?:'up'|'down'}>, headline:string, net:number}|null}
 */
export function stakeResultView(stake) {
  if (!stake || (stake.status !== 'settled' && stake.status !== 'forfeited')) return null;
  const net = Number(stake.net) || 0;
  const tone = net > 0 ? 'up' : net < 0 ? 'down' : undefined;
  const rows = [{ label: '投入', value: `${stake.amount}` }];
  if (stake.status === 'settled') {
    rows.push({ label: '盈亏', value: signed(stake.profit), tone: stake.profit > 0 ? 'up' : stake.profit < 0 ? 'down' : undefined });
    if (stake.fee > 0) rows.push({ label: '对局费（盈利的 10%）', value: `−${stake.fee}` });
    rows.push({ label: '到账', value: `${stake.payout}`, tone });
  } else {
    rows.push({ label: '到账', value: '0', tone: 'down' });
  }
  const tiny = net === 0 && stake.returnPpm != null && Number(stake.returnPpm) !== 0; // gain/loss rounds to under 1 coin
  const headline =
    net > 0 ? `赚了 ${net} 韭币` : net < 0 ? `亏了 ${-net} 韭币` : tiny ? '涨跌不足 1 韭币，本金原样退回' : '不赚不亏，本金原样退回';
  return { rows, headline, net };
}

export function clampToBalance(stake, balance) {
  const b = balance == null ? NaN : Math.floor(Number(balance));
  const s = clampStake(stake);
  return Number.isFinite(b) && b >= STAKE_MIN && s > b ? Math.min(b, STAKE_MAX) : s;
}
