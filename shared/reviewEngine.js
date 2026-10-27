/**
 * 深度复盘 engine — pure functions (no DOM / db / network), shared by server and tests.
 *
 * Given the 30-bar window of a settled game plus the player's 29 actions it computes:
 *   - the true optimal action sequence under the same rules (T+1, fill mode, optional buy cap) by DP,
 *   - equity curves for me / optimal / buy&hold, built with the production equity-curve code,
 *   - where the gap to optimal came from (空仓错过 / 没跑掉 / 进出场价差),
 *   - a verdict for each of the player's round trips and a few plain-language lines.
 *
 * Nothing here changes settlement math; it only reads `settleGame` / `buildEquityCurveCash`.
 */
import { GAME_DAYS, DECISION_DAYS, FILL_MODES } from './rules.js';
import { settleGame } from './engine.js';
import { buildEquityCurveCash } from './equityCurve.js';

export const REVIEW_VERSION = 1;

const NEG = -Infinity;
/** Cap on distinct buys the DP tracks when the mode has no cap (29 days ⇒ at most 15 round trips anyway). */
const MAX_TRACKED_BUYS = 15;

function fillInfo(fillMode, bars, day) {
  // day = decision day 1..29 → { fillDay, price }
  return fillMode === 'same_close'
    ? { fillDay: day, price: bars[day - 1].close }
    : { fillDay: day + 1, price: bars[day].open };
}

function assertInput(fillMode, bars) {
  if (!FILL_MODES.includes(fillMode)) throw new Error(`invalid fillMode: ${fillMode}`);
  if (!Array.isArray(bars) || bars.length !== GAME_DAYS) throw new Error(`bars must have length ${GAME_DAYS}`);
}

/**
 * Best legal action sequence for the window.
 * Position is flat or all-in, buy fills at fillMode price, a sell must fill strictly after the buy fill (T+1),
 * a position still open after day 29 is valued at the day-30 close. Because every round trip multiplies the
 * account by sell/buy, maximising the sum of logs maximises the final multiple.
 *
 * @param {{ fillMode: string, bars: object[], maxBuys?: number }} opts maxBuys: cap on buys (oneshot = 1); omit for no cap.
 * @returns {{ actions: string[], multiple: number, buys: number }}
 */
export function optimalActions({ fillMode, bars, maxBuys = Infinity }) {
  assertInput(fillMode, bars);
  const K = Math.max(0, Math.min(Number.isFinite(maxBuys) ? Math.floor(maxBuys) : MAX_TRACKED_BUYS, MAX_TRACKED_BUYS));
  const lnBuy = [];
  const lnSell = [];
  for (let d = 1; d <= DECISION_DAYS; d++) {
    const px = Math.log(fillInfo(fillMode, bars, d).price);
    lnBuy[d] = -px;
    lnSell[d] = px;
  }
  const lnEnd = Math.log(bars[GAME_DAYS - 1].close);

  // E[k]: flat after k buys; H[k]: holding the k-th buy. choice[d][s] = true when the state was reached by trading on day d.
  let E = new Array(K + 1).fill(NEG);
  let H = new Array(K + 1).fill(NEG);
  E[0] = 0;
  const choice = [];
  for (let d = 1; d <= DECISION_DAYS; d++) {
    const nE = new Array(K + 1).fill(NEG);
    const nH = new Array(K + 1).fill(NEG);
    const tradedE = new Array(K + 1).fill(false);
    const tradedH = new Array(K + 1).fill(false);
    for (let k = 0; k <= K; k++) {
      // hold keeps the state; selling needs yesterday's holding (so buy and sell never share a day).
      nE[k] = E[k];
      if (H[k] > NEG && H[k] + lnSell[d] > nE[k] + 1e-12) { nE[k] = H[k] + lnSell[d]; tradedE[k] = true; }
      nH[k] = H[k];
      if (k >= 1 && E[k - 1] > NEG && E[k - 1] + lnBuy[d] > nH[k] + 1e-12) { nH[k] = E[k - 1] + lnBuy[d]; tradedH[k] = true; }
    }
    choice[d] = { e: tradedE, h: tradedH };
    E = nE;
    H = nH;
  }

  // Final value: flat, or holding valued at the day-30 close. Prefer fewer buys on ties.
  let best = NEG;
  let bestState = { pos: 'E', k: 0 };
  for (let k = 0; k <= K; k++) {
    if (E[k] > best + 1e-12) { best = E[k]; bestState = { pos: 'E', k }; }
    if (H[k] > NEG && H[k] + lnEnd > best + 1e-12) { best = H[k] + lnEnd; bestState = { pos: 'H', k }; }
  }

  const actions = new Array(DECISION_DAYS).fill('hold');
  let { pos, k } = bestState;
  for (let d = DECISION_DAYS; d >= 1; d--) {
    const traded = pos === 'E' ? choice[d].e[k] : choice[d].h[k];
    if (!traded) continue;
    if (pos === 'E') { actions[d - 1] = 'sell'; pos = 'H'; } else { actions[d - 1] = 'buy'; pos = 'E'; k -= 1; }
  }
  return { actions, multiple: Math.exp(best), buys: bestState.k };
}

/** Per-day exposure: out[t] (t=1..30) is true while the account is long at the close of day t. out[0] unused. */
export function exposureByDay({ fillMode, actions }) {
  const out = new Array(GAME_DAYS + 1).fill(false);
  const events = new Map(); // fillDay -> 'buy' | 'sell'
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a !== 'buy' && a !== 'sell') continue;
    events.set(fillMode === 'same_close' ? i + 1 : i + 2, a);
  }
  let long = false;
  for (let t = 1; t <= GAME_DAYS; t++) {
    const ev = events.get(t);
    if (ev === 'buy') long = true;
    else if (ev === 'sell') long = false;
    out[t] = long;
  }
  return out;
}

const toPct = (multiple) => (multiple - 1) * 100;
const r2 = (x) => Math.round(x * 100) / 100;

function curveMultiples({ fillMode, bars, actions }) {
  const cash = buildEquityCurveCash({ fillMode, bars, actions, finish: true });
  return cash.map((e) => e / cash[0]);
}

/** Buy & hold under the same fill convention, as a 31-point multiple curve. */
export function holdCurve({ fillMode, bars }) {
  const buyPrice = fillMode === 'same_close' ? bars[0].close : bars[1].open;
  const firstDay = fillMode === 'same_close' ? 1 : 2;
  const curve = [1];
  for (let t = 1; t <= GAME_DAYS; t++) curve.push(t < firstDay ? 1 : bars[t - 1].close / buyPrice);
  return curve;
}

/**
 * Where the log-gap between optimal and mine came from, split by whether each side was in the market that day.
 * Returns percentage points that add up to optimal% − mine%.
 */
export function attributeGap(mineCurve, optCurve) {
  let missed = 0; // I was out, optimal was in
  let stayed = 0; // I was in, optimal was out
  let spread = 0; // both in: different entry / exit prices
  for (let t = 1; t <= GAME_DAYS; t++) {
    const mr = Math.log(mineCurve[t] / mineCurve[t - 1]);
    const or = Math.log(optCurve[t] / optCurve[t - 1]);
    const mineIn = Math.abs(mr) > 1e-12;
    const optIn = Math.abs(or) > 1e-12;
    const d = or - mr;
    if (!mineIn && optIn) missed += d;
    else if (mineIn && !optIn) stayed += d;
    else spread += d;
  }
  const total = missed + stayed + spread;
  const gapPct = toPct(optCurve[GAME_DAYS]) - toPct(mineCurve[GAME_DAYS]);
  if (!(Math.abs(total) > 1e-12) || !(gapPct > 1e-9)) return { missed: 0, stayed: 0, spread: 0, gapPct: Math.max(0, r2(gapPct)) };
  const k = gapPct / total;
  return { missed: r2(missed * k), stayed: r2(stayed * k), spread: r2(spread * k), gapPct: r2(gapPct) };
}

function rangeOver(bars, fromDay, toDay) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let d = Math.max(1, fromDay); d <= Math.min(GAME_DAYS, toDay); d++) {
    const b = bars[d - 1];
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

/** Round trips from the production replay (a position held to day 30 closes at the valuation). */
export function roundTrips({ fillMode, bars, actions }) {
  const rep = settleGame({ fillMode, bars, actions });
  if (!rep.ok) return [];
  const out = [];
  let open = null;
  for (const t of rep.trades) {
    if (t.type === 'buy') open = { buyDay: t.day, buyPrice: t.price };
    else if (open) {
      out.push({ ...open, sellDay: t.day, sellPrice: t.price, held: false });
      open = null;
    }
  }
  if (open && rep.valuation) out.push({ ...open, sellDay: GAME_DAYS, sellPrice: rep.valuation.price, held: true });
  return out;
}

/** Best exit the window offered after this entry (legal sell fills strictly after the buy fill, or the day-30 close). */
function bestExit({ fillMode, bars }, buyDay) {
  let best = { price: bars[GAME_DAYS - 1].close, day: GAME_DAYS };
  for (let d = 1; d <= DECISION_DAYS; d++) {
    const f = fillInfo(fillMode, bars, d);
    if (f.fillDay > buyDay && f.price > best.price) best = { price: f.price, day: f.fillDay };
  }
  return best;
}

/** Judge one round trip with rules that only need the window itself. Tags are short Chinese labels. */
export function judgeTrip(ctx, trip) {
  const { bars, fillMode } = ctx;
  const ret = (trip.sellPrice / trip.buyPrice - 1) * 100;
  const tags = [];
  const notes = [];

  // Entry: where did the price sit in the previous ten days?
  const before = rangeOver(bars, trip.buyDay - 10, trip.buyDay - 1);
  if (before && trip.buyDay >= 4 && before.hi > before.lo) {
    const pos = (trip.buyPrice - before.lo) / (before.hi - before.lo);
    if (pos >= 0.8) { tags.push('追高'); notes.push('买在近 10 日区间的高位'); }
    else if (pos <= 0.2) { tags.push('抄在低位'); notes.push('买在近 10 日区间的低位'); }
  }

  // Exit: what happened in the five days after selling?
  if (!trip.held && trip.sellDay < GAME_DAYS) {
    const after = rangeOver(bars, trip.sellDay + 1, trip.sellDay + 5);
    if (after) {
      const up = (after.hi / trip.sellPrice - 1) * 100;
      if (up >= 5) { tags.push('卖飞'); notes.push(`卖出后 5 日内最高又涨了 ${up.toFixed(1)}%`); }
      else if (ret > 0 && up <= 1) { tags.push('卖在高点'); notes.push('卖出后 5 日内没再创新高'); }
      if (ret < 0 && after.hi >= trip.buyPrice) { tags.push('割在底部'); notes.push('卖出后 5 日内价格涨回了你的买入价'); }
    }
  }
  if (trip.held) { tags.push('拿到最后'); }

  // Pain along the way.
  const hold = rangeOver(bars, trip.buyDay, trip.held ? GAME_DAYS : trip.sellDay);
  let worst = 0;
  if (hold) {
    worst = (hold.lo / trip.buyPrice - 1) * 100;
    if (worst <= -10) { tags.push('深套'); notes.push(`持仓期间最深浮亏 ${worst.toFixed(1)}%`); }
  }
  const days = trip.sellDay - trip.buyDay;
  if (days >= 5 && ret >= 5) tags.push('拿得住');

  const exit = bestExit({ bars, fillMode }, trip.buyDay);
  const bestRet = (exit.price / trip.buyPrice - 1) * 100;
  return {
    buyDay: trip.buyDay,
    buyPrice: r2(trip.buyPrice),
    sellDay: trip.sellDay,
    sellPrice: r2(trip.sellPrice),
    held: trip.held,
    holdDays: days,
    returnPct: r2(ret),
    worstDrawdownPct: r2(Math.min(0, worst)),
    bestExitDay: exit.day,
    bestExitReturnPct: r2(bestRet),
    tags,
    notes,
  };
}

/**
 * The stops of the guided replay: one per optimal buy / sell. Reasons are written from hindsight and only use the
 * window's own prices (never pretend the player could have known). `day` is the decision day (the day the player
 * would click), `fillDay` / `price` are where the order fills under the game's fill mode.
 */
export function routeSteps({ fillMode, bars, actions }) {
  const trips = roundTrips({ fillMode, bars, actions });
  const steps = [];
  const pctOf = (to, from) => (to / from - 1) * 100;
  const sg = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
  trips.forEach((trip, i) => {
    const n = trips.length;
    const buyDecision = fillMode === 'same_close' ? trip.buyDay : trip.buyDay - 1;
    const bf = fillInfo(fillMode, bars, buyDecision);
    const tripRet = pctOf(trip.sellPrice, trip.buyPrice);

    const buyReasons = [];
    buyReasons.push(
      `从这里买入，一路拿到第 ${trip.sellDay} 天${trip.held ? '（按期末收盘估值）' : '卖出'}，这一段累计 ${sg(tripRet)}${n > 1 ? `（最优路线共 ${n} 笔，这是第 ${i + 1} 笔）` : '，是这 30 天里最划算的一段'}。`
    );
    const before = rangeOver(bars, buyDecision - 9, buyDecision);
    if (before && buyDecision >= 4 && before.hi > before.lo) {
      const pos = (trip.buyPrice - before.lo) / (before.hi - before.lo);
      if (pos <= 0.35) buyReasons.push(`买点在近 10 日区间的低位（约 ${Math.round(pos * 100)}% 位置），价格已经被压了一阵。`);
      else if (pos >= 0.65) buyReasons.push(`买点在近 10 日区间的偏高位置（约 ${Math.round(pos * 100)}%），属于顺势买入，之后价格继续走强。`);
    }
    if (buyDecision >= 4) {
      const drop = pctOf(bars[buyDecision - 1].close, bars[buyDecision - 4].close);
      if (drop <= -4) buyReasons.push(`此前 3 天累计下跌 ${Math.abs(drop).toFixed(1)}%，抛压在这几天被释放。`);
    }
    const ahead = rangeOver(bars, bf.fillDay, Math.min(GAME_DAYS, bf.fillDay + 9));
    if (ahead) buyReasons.push(`成交后 10 天内，最高涨到 ${sg(pctOf(ahead.hi, trip.buyPrice))}，最低 ${sg(pctOf(ahead.lo, trip.buyPrice))}。`);

    steps.push({ day: buyDecision, action: 'buy', fillDay: bf.fillDay, price: r2(bf.price), reasons: buyReasons, tripIndex: i });

    if (!trip.held) {
      const sellDecision = fillMode === 'same_close' ? trip.sellDay : trip.sellDay - 1;
      const sellReasons = [];
      const span = rangeOver(bars, trip.buyDay, trip.sellDay);
      sellReasons.push(`这一波从第 ${trip.buyDay} 天的 ${trip.buyPrice.toFixed(2)} 涨到 ${trip.sellPrice.toFixed(2)}，累计 ${sg(tripRet)}。`);
      if (span) {
        const gapToTop = pctOf(span.hi, trip.sellPrice);
        if (gapToTop <= 2) sellReasons.push(`卖出价离这一波最高点只差 ${Math.max(0, gapToTop).toFixed(1)}%，已经基本卖在顶部。`);
      }
      const after = trip.sellDay < GAME_DAYS ? rangeOver(bars, trip.sellDay + 1, Math.min(GAME_DAYS, trip.sellDay + 5)) : null;
      if (after) {
        sellReasons.push(`卖出后 5 天内，最高只有 ${sg(pctOf(after.hi, trip.sellPrice))}，最低跌到 ${sg(pctOf(after.lo, trip.sellPrice))}，继续拿着不划算。`);
      }
      const next = trips[i + 1];
      if (next) sellReasons.push(`卖出后空仓等待，下一个买点在第 ${fillMode === 'same_close' ? next.buyDay : next.buyDay - 1} 天。`);
      steps.push({ day: sellDecision, action: 'sell', fillDay: trip.sellDay, price: r2(trip.sellPrice), reasons: sellReasons, tripIndex: i });
    }
  });
  return steps;
}

function fmtPct(x, digits = 2) {
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`;
}

/** Plain-language lines, most important first (at most five). */
export function buildInsights({ minePct, optPct, holdPct, gap, trips, mineBuys, optBuys, exposureMine, exposureOpt }) {
  const lines = [];
  if (optPct <= 0.005) {
    lines.push('这段行情怎么操作都赚不到钱：最优做法就是空仓不动。');
    if (minePct < -0.005) lines.push(`你这局亏了 ${fmtPct(minePct)}，其中每一笔交易都是在送钱，下一局先想清楚「要不要出手」。`);
    return lines;
  }
  if (minePct >= optPct - 0.005) {
    lines.push('你这局的操作和最优解一样好，没有可以挑剔的地方。');
    return lines;
  }
  const capture = minePct > 0 ? Math.round((minePct / optPct) * 100) : 0;
  lines.push(
    minePct > 0
      ? `这局最优操作能赚 ${fmtPct(optPct)}，你拿到了 ${fmtPct(minePct)}，约 ${capture}%。`
      : `这局最优操作能赚 ${fmtPct(optPct)}，而你的结果是 ${fmtPct(minePct)}，差了 ${gap.gapPct.toFixed(2)} 个点。`
  );

  const leaks = [
    ['missed', gap.missed, `最大的缺口是「空仓错过」：最优操作在场、你不在场的那些天，一共漏掉 ${gap.missed.toFixed(2)} 个点。`],
    ['stayed', gap.stayed, `最大的缺口是「该跑没跑」：最优操作已经离场、你还拿着的那些天，一共多亏 ${gap.stayed.toFixed(2)} 个点。`],
    ['spread', gap.spread, `最大的缺口是「进出场价差」：两边都在场，但你买得更贵或卖得更早，一共差 ${gap.spread.toFixed(2)} 个点。`],
  ].sort((a, b) => b[1] - a[1]);
  if (leaks[0][1] >= 0.5) lines.push(leaks[0][2]);

  const outDays = exposureMine.slice(1).filter((x) => !x).length;
  const optIn = exposureOpt.slice(1).filter(Boolean).length;
  if (mineBuys === 0) lines.push('你整局没有出手。最优操作要在场 ' + optIn + ' 天。');
  else if (outDays >= 15) lines.push(`你有 ${outDays} 天空仓，占了一半以上。最优操作只在场 ${optIn} 天，但每一天都挑得很准。`);

  if (mineBuys >= optBuys + 3) lines.push(`你交易了 ${mineBuys} 次，最优操作只需要 ${optBuys} 次。出手越多，不等于机会越多。`);

  const flagged = trips.filter((t) => t.tags.includes('割在底部') || t.tags.includes('卖飞') || t.tags.includes('追高'));
  if (flagged.length) {
    const t = [...flagged].sort((a, b) => a.returnPct - b.returnPct)[0];
    const why = t.tags.filter((x) => ['割在底部', '卖飞', '追高'].includes(x)).join('、');
    lines.push(`最值得回看的一笔：第 ${t.buyDay} 天买、第 ${t.sellDay} 天${t.held ? '估值' : '卖'}（${fmtPct(t.returnPct)}），问题是「${why}」。`);
  }
  if (holdPct > minePct + 0.005 && lines.length < 5) lines.push(`顺带一提：这局什么都不做、第一天买入拿到底是 ${fmtPct(holdPct)}。`);
  return lines.slice(0, 5);
}

/**
 * Everything the 深度复盘 sheet shows.
 * @param {{ fillMode: string, bars: object[], actions: string[], maxBuys?: number, dates?: string[] }} input
 */
export function buildReview({ fillMode, bars, actions, maxBuys = Infinity, dates = null }) {
  assertInput(fillMode, bars);
  if (!Array.isArray(actions) || actions.length !== DECISION_DAYS) throw new Error(`actions must have length ${DECISION_DAYS}`);
  const rep = settleGame({ fillMode, bars, actions });
  if (!rep.ok) throw new Error(rep.message || 'invalid action sequence');

  const opt = optimalActions({ fillMode, bars, maxBuys });
  const mineCurve = curveMultiples({ fillMode, bars, actions });
  const optCurve = curveMultiples({ fillMode, bars, actions: opt.actions });
  const hold = holdCurve({ fillMode, bars });
  const minePct = toPct(mineCurve[GAME_DAYS]);
  const optPct = toPct(optCurve[GAME_DAYS]);
  const holdPct = toPct(hold[GAME_DAYS]);
  const expMine = exposureByDay({ fillMode, actions });
  const expOpt = exposureByDay({ fillMode, actions: opt.actions });
  const gap = attributeGap(mineCurve, optCurve);

  const ctx = { fillMode, bars };
  const trips = roundTrips({ fillMode, bars, actions }).map((t) => judgeTrip(ctx, t));
  const optTrips = roundTrips({ fillMode, bars, actions: opt.actions }).map((t) => ({
    buyDay: t.buyDay,
    buyPrice: r2(t.buyPrice),
    sellDay: t.sellDay,
    sellPrice: r2(t.sellPrice),
    held: t.held,
    returnPct: r2((t.sellPrice / t.buyPrice - 1) * 100),
  }));
  const mineBuys = actions.filter((a) => a === 'buy').length;

  const days = [];
  for (let d = 1; d <= DECISION_DAYS; d++) {
    days.push({
      day: d,
      date: dates ? dates[d - 1] || null : bars[d - 1].date || null,
      close: r2(bars[d - 1].close),
      mine: actions[d - 1],
      opt: opt.actions[d - 1],
      mineIn: expMine[d],
      optIn: expOpt[d],
    });
  }

  return {
    v: REVIEW_VERSION,
    fillMode,
    mine: { returnPct: r2(minePct), actions: [...actions], curve: mineCurve.map((x) => Math.round(x * 1e5) / 1e5), buys: mineBuys, trips },
    optimal: { returnPct: r2(optPct), actions: opt.actions, curve: optCurve.map((x) => Math.round(x * 1e5) / 1e5), buys: opt.buys, trips: optTrips },
    hold: { returnPct: r2(holdPct), curve: hold.map((x) => Math.round(x * 1e5) / 1e5) },
    route: routeSteps({ fillMode, bars, actions: opt.actions }),
    capturePct: optPct > 0.005 && minePct > 0 ? Math.min(100, Math.round((minePct / optPct) * 100)) : null,
    gap,
    days,
    insights: buildInsights({
      minePct, optPct, holdPct, gap, trips, mineBuys, optBuys: opt.buys, exposureMine: expMine, exposureOpt: expOpt,
    }),
  };
}

/** The free preview shown before unlocking: only the two headline numbers. */
export function reviewTeaser({ fillMode, bars, actions, maxBuys = Infinity }) {
  assertInput(fillMode, bars);
  const rep = settleGame({ fillMode, bars, actions });
  if (!rep.ok) throw new Error(rep.message || 'invalid action sequence');
  const opt = optimalActions({ fillMode, bars, maxBuys });
  const optPct = toPct(opt.multiple);
  const minePct = toPct(rep.equityMultiple);
  return {
    optimalReturnPct: r2(optPct),
    yourReturnPct: r2(minePct),
    capturePct: optPct > 0.005 && minePct > 0 ? Math.min(100, Math.round((minePct / optPct) * 100)) : null,
  };
}
