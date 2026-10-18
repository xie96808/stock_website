/**
 * Lightweight deterministic PvP replay. No optimal-trade search and no
 * dependency on the browser analysis module. A failure here must not be
 * treated as a reason to change a stored payout.
 */
import { settleGame, roundHalfUp } from './engine.js';
import { buildEquityCurveCash, buyHoldBenchmarkPpm, mddPpmFromCurve } from './equityCurve.js';
import { GAME_DAYS, INITIAL_CASH } from './rules.js';
import { PVP_FILL_MODE } from './pvpMetrics.js';

export const PVP_ANALYSIS_VERSION = 'pvp-analysis-v2';

const ACTION_WORD = { buy: '买入', sell: '卖出', hold: '持有' };

function ppmOf(cash) {
  return cash.map((value) => roundHalfUp((value / INITIAL_CASH - 1) * 1e6));
}

function tradeCounts(actions) {
  let buy = 0;
  let sell = 0;
  for (const action of actions) {
    if (action === 'buy') buy += 1;
    else if (action === 'sell') sell += 1;
  }
  return { buy, sell };
}

function signedPoints(ppm) {
  const text = (Number(ppm) / 10000).toFixed(2);
  return ppm > 0 ? `+${text}` : text;
}

/**
 * Round N is decided after day N's close and fills at day N+1's open (PvP is next_open), so its
 * effect shows up in day N+1's return, not day N's. The text says exactly that and never claims a cause.
 */
export function divergenceText({ round, me, opponent, gapChangePpm }) {
  const mine = ACTION_WORD[me] || '操作';
  const theirs = ACTION_WORD[opponent] || '操作';
  const next = round + 1;
  const dayWord = next >= GAME_DAYS ? `第 ${next} 个交易日（终局估值）` : `第 ${next} 个交易日`;
  return `第 ${round} 回合，你${mine}，对手${theirs}。这一回合的操作在${dayWord}开盘成交，当日两人收益差变化 ${signedPoints(gapChangePpm)} 个百分点。这只说明操作不同，不能据此断定是这次操作造成的。`;
}

/**
 * Among decided rounds whose actions differ, keep at most `limit`,
 * largest absolute gap change first. Equal changes keep the earlier round.
 * Round N's action is paired with the NEXT day's return change (ppm[N+1] - ppm[N]); for the last
 * round ppm[N+1] is the final valuation. Rounds whose next day is not revealed yet are skipped.
 */
export function pickDivergences({ actionsA, actionsB, ppmA, ppmB, limit = 3 } = {}) {
  const rounds = Math.min(actionsA?.length || 0, actionsB?.length || 0);
  const rows = [];
  for (let round = 1; round <= rounds; round += 1) {
    const seat1 = actionsA[round - 1];
    const seat2 = actionsB[round - 1];
    if (seat1 === seat2) continue;
    if (!Number.isInteger(ppmA?.[round]) || !Number.isInteger(ppmB?.[round])) continue;
    if (!Number.isInteger(ppmA?.[round + 1]) || !Number.isInteger(ppmB?.[round + 1])) continue;
    const gapChangePpm = (ppmA[round + 1] - ppmB[round + 1]) - (ppmA[round] - ppmB[round]);
    rows.push({ round, seat1, seat2, gapChangePpm, abs: Math.abs(gapChangePpm) });
  }
  rows.sort((a, b) => (b.abs - a.abs) || (a.round - b.round));
  return rows.slice(0, limit).map(({ abs, ...row }) => row);
}

function curveFor(bars, actions, revealedBars, completed) {
  const finish = completed === true;
  const cash = buildEquityCurveCash({
    fillMode: PVP_FILL_MODE,
    bars,
    actions,
    finish,
  });
  const need = revealedBars + 1;
  if (cash.length < need) {
    throw new Error('equity curve is shorter than the revealed window');
  }
  const slice = cash.slice(0, need);
  return { cash: slice, ppm: ppmOf(slice), mddPpm: mddPpmFromCurve(slice) };
}

/**
 * @param {{ bars: object[], seat1Actions: string[], seat2Actions: string[], revealedBars: number, completed?: boolean }} input
 */
export function buildPvpAnalysis({ bars, seat1Actions, seat2Actions, revealedBars, completed = false } = {}) {
  if (!Array.isArray(bars) || bars.length !== GAME_DAYS) {
    throw new Error('replay needs the stored 30-bar window');
  }
  if (!Number.isInteger(revealedBars) || revealedBars < 1 || revealedBars > GAME_DAYS) {
    throw new Error('revealed window is invalid');
  }
  const actionsA = Array.isArray(seat1Actions) ? seat1Actions : [];
  const actionsB = Array.isArray(seat2Actions) ? seat2Actions : [];
  if (actionsA.length !== actionsB.length) throw new Error('action tails differ');
  if (completed && (actionsA.length !== 29 || revealedBars !== GAME_DAYS)) {
    throw new Error('completed replay is missing a full action tail');
  }
  const left = curveFor(bars, actionsA, revealedBars, completed);
  const right = curveFor(bars, actionsB, revealedBars, completed);
  const valued = { 1: false, 2: false };
  if (completed) {
    const settledA = settleGame({ fillMode: PVP_FILL_MODE, bars, actions: actionsA });
    const settledB = settleGame({ fillMode: PVP_FILL_MODE, bars, actions: actionsB });
    if (settledA.ok !== true || settledB.ok !== true) throw new Error('valuation failed');
    valued[1] = settledA.valuation != null;
    valued[2] = settledB.valuation != null;
  }
  return {
    version: PVP_ANALYSIS_VERSION,
    revealedBars,
    completed: completed === true,
    curves: { 1: left.ppm, 2: right.ppm },
    curveMddPpm: { 1: left.mddPpm, 2: right.mddPpm },
    trades: { 1: tradeCounts(actionsA), 2: tradeCounts(actionsB) },
    valued,
    buyHoldPpm: completed ? buyHoldBenchmarkPpm({ fillMode: PVP_FILL_MODE, bars }) : null,
    divergences: pickDivergences({
      actionsA,
      actionsB,
      ppmA: left.ppm,
      ppmB: right.ppm,
    }),
  };
}

function curvePoints(ppm) {
  return (ppm || []).map((returnPpm, day) => ({ day, returnPpm }));
}

/** Viewer-relative replay. Seat 2 flips the gap sign. No raw prices or names. */
export function projectReplay(doc, viewerSeat) {
  if (!doc || (viewerSeat !== 1 && viewerSeat !== 2)) return null;
  const mine = viewerSeat;
  const other = viewerSeat === 1 ? 2 : 1;
  const sign = viewerSeat === 1 ? 1 : -1;
  return {
    status: 'ready',
    version: doc.version,
    revealedDay: doc.revealedBars,
    me: {
      curve: curvePoints(doc.curves[mine]),
      buyCount: doc.trades[mine].buy,
      sellCount: doc.trades[mine].sell,
      curveMddPpm: doc.curveMddPpm[mine],
      valued: doc.valued[mine] === true,
    },
    opponent: {
      curve: curvePoints(doc.curves[other]),
      buyCount: doc.trades[other].buy,
      sellCount: doc.trades[other].sell,
      curveMddPpm: doc.curveMddPpm[other],
      valued: doc.valued[other] === true,
    },
    buyHoldPpm: doc.buyHoldPpm,
    divergences: (doc.divergences || []).map((row) => {
      const meAction = viewerSeat === 1 ? row.seat1 : row.seat2;
      const opponentAction = viewerSeat === 1 ? row.seat2 : row.seat1;
      const gapChangePpm = row.gapChangePpm * sign;
      return {
        round: row.round,
        dayLabel: `d${row.round}`,
        effectDay: row.round + 1,
        me: meAction,
        opponent: opponentAction,
        gapChangePpm,
        text: divergenceText({ round: row.round, me: meAction, opponent: opponentAction, gapChangePpm }),
      };
    }),
  };
}
