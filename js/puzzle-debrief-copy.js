/**
 * Pure formatter for F02 puzzle-specific teaching debrief (残局专属复盘).
 * Template + filled facts only — no runtime LLM. Desk-note tone.
 */
import {
  formatTwoStarGoalLine,
  formatThreeStarGoalLine,
} from './puzzle-goals-copy.js';
import { stripStarPrefix } from './puzzle-settle-copy.js';

/** @param {unknown} ppm @returns {string|null} percent with 2 decimals, no + */
export function ppmToPctString(ppm) {
  if (ppm == null || !Number.isFinite(Number(ppm))) return null;
  return (Number(ppm) / 10000).toFixed(2);
}

/** @param {unknown} ppm @returns {string|null} signed percentage-point edge */
export function formatSignedPp(ppm) {
  if (ppm == null || !Number.isFinite(Number(ppm))) return null;
  const n = Number(ppm) / 10000;
  const s = n.toFixed(2);
  if (n > 0) return `+${s}`;
  return s;
}

/**
 * 对照买持 — numbers + one measured paragraph.
 * @param {{
 *   returnPpm?: number|null,
 *   benchmarkReturnPpm?: number|null,
 *   edgePpm?: number|null,
 * }} pr
 */
export function formatBuyHoldCompare(pr = {}) {
  const yourPct = ppmToPctString(pr.returnPpm);
  const bhPct = ppmToPctString(pr.benchmarkReturnPpm);
  let edgePpm = pr.edgePpm;
  if (
    (edgePpm == null || !Number.isFinite(Number(edgePpm))) &&
    pr.returnPpm != null &&
    pr.benchmarkReturnPpm != null &&
    Number.isFinite(Number(pr.returnPpm)) &&
    Number.isFinite(Number(pr.benchmarkReturnPpm))
  ) {
    edgePpm = Number(pr.returnPpm) - Number(pr.benchmarkReturnPpm);
  }
  const edgePp = formatSignedPp(edgePpm);
  if (yourPct == null || bhPct == null || edgePp == null) return null;

  const yourSigned = Number(yourPct) > 0 ? `+${yourPct}` : yourPct;
  const bhSigned = Number(bhPct) > 0 ? `+${bhPct}` : bhPct;

  let edgeClause;
  if (Number(edgePp) > 0) {
    edgeClause = `相对买入持有多出 ${edgePp} 个百分点`;
  } else if (Number(edgePp) < 0) {
    edgeClause = `相对买入持有落后 ${edgePp} 个百分点`;
  } else {
    edgeClause = '相对买入持有基本持平';
  }

  const paragraph =
    `本窗你的收益率约 ${yourSigned}%，同期买入持有约 ${bhSigned}%，${edgeClause}。` +
    `短窗里这条差额主要反映你是否在窗口内卖出、卖出后是否空仓走到末日估值，以及持仓区间与买持路径是否重合。`;

  return {
    yourReturnPct: yourSigned,
    buyHoldReturnPct: bhSigned,
    edgePp,
    summaryLine: `你 ${yourSigned}% · 买持 ${bhSigned}% · 差额 ${edgePp}pp`,
    paragraph,
  };
}

/**
 * 星级拆解 — which 2★ / 3★ constraints were met or missed.
 * @param {object|null|undefined} pr puzzleResult
 */
export function formatStarBreakdown(pr) {
  if (!pr || pr.stars == null || !Number.isFinite(Number(pr.stars))) return null;
  const starN = Math.max(0, Math.min(3, Math.floor(Number(pr.stars))));
  const goals = pr.goals || null;
  const twoRaw = formatTwoStarGoalLine(goals) || '二星：收益优于买入持有';
  const threeRaw = formatThreeStarGoalLine(goals) || '三星：回撤与成交约束';
  const twoLabel = stripStarPrefix(twoRaw) || '收益优于买入持有';
  const threeLabel = stripStarPrefix(threeRaw) || '回撤与成交约束';

  const edgePp = formatSignedPp(
    pr.edgePpm != null
      ? pr.edgePpm
      : pr.returnPpm != null && pr.benchmarkReturnPpm != null
        ? Number(pr.returnPpm) - Number(pr.benchmarkReturnPpm)
        : null
  );
  const mddPct = ppmToPctString(pr.mddPpm);
  const tradeCount =
    pr.tradeCount != null && Number.isFinite(Number(pr.tradeCount))
      ? Number(pr.tradeCount)
      : null;

  const oneMet = starN >= 1;
  const twoMet = !!(pr.twoStarMet || starN >= 2);
  const threeMet = !!(pr.threeStarMet || starN >= 3);

  const twoText =
    edgePp != null
      ? twoMet
        ? `${twoLabel}（本局相对买持 ${edgePp}pp）`
        : `${twoLabel}（本局相对买持 ${edgePp}pp，未达线）`
      : twoLabel;

  const threeFacts = [];
  const maxMdd = goals?.threeStar?.maxMddPct;
  const maxOrders = goals?.threeStar?.maxOrders;
  if (mddPct != null && maxMdd != null && Number.isFinite(Number(maxMdd))) {
    threeFacts.push(`回撤 ${mddPct}% / 上限 ${maxMdd}%`);
  } else if (mddPct != null) {
    threeFacts.push(`回撤 ${mddPct}%`);
  }
  if (tradeCount != null && maxOrders != null && Number.isFinite(Number(maxOrders))) {
    threeFacts.push(`成交 ${tradeCount} 笔 / 上限 ${maxOrders} 笔`);
  } else if (tradeCount != null) {
    threeFacts.push(`成交 ${tradeCount} 笔`);
  }
  const factSuffix = threeFacts.length ? `（本局 ${threeFacts.join('，')}）` : '';
  const threeText = `${threeLabel}${factSuffix}`;

  const items = [
    {
      met: oneMet,
      label: '合法完成结算',
      ariaLabel: oneMet ? '一星已达成' : '一星未达成',
    },
    {
      met: twoMet,
      label: twoText,
      ariaLabel: twoMet ? '二星已达成' : '二星未达成',
    },
    {
      met: threeMet,
      label: threeText,
      ariaLabel: threeMet ? '三星已达成' : '三星未达成',
    },
  ];

  const lines = items.map((it) => `${it.met ? '✓' : '○'} ${it.label}`);

  let paragraph;
  if (starN >= 3) {
    paragraph =
      `本关记 ${starN} 星。二星相对买持与三星回撤/成交约束均已满足` +
      (edgePp != null ? `；相对买持差额约 ${edgePp}pp` : '') +
      (mddPct != null ? `，窗口内最大回撤约 ${mddPct}%` : '') +
      (tradeCount != null ? `，实际成交 ${tradeCount} 笔` : '') +
      '。';
  } else if (starN >= 2) {
    paragraph =
      `本关记 ${starN} 星：相对买持目标已达成` +
      (edgePp != null ? `（差额约 ${edgePp}pp）` : '') +
      '，三星侧回撤或成交笔数尚未同时压进关卡给出的上限。';
  } else {
    paragraph =
      `本关记 ${starN} 星，合法完成了结算，但相对买持的超额尚未达到二星门槛` +
      (edgePp != null ? `（本局差额约 ${edgePp}pp）` : '') +
      '。三星约束在未达二星时不另行计分。';
  }

  return { starN, items, lines, paragraph };
}

/**
 * Describe open position / constraints from initialState + hints.
 * @param {{
 *   initialState?: object|null,
 *   openStateHint?: string|null,
 *   maxOrders?: number|null,
 *   theme?: string|null,
 * }} ctx
 */
export function describeOpenSituation(ctx = {}) {
  const init = ctx.initialState || {};
  const qty = Number(init.qty) || 0;
  const cash = Number(init.cash);
  const firstSellable = Number(init.firstSellableDay) || 1;
  const cost = Number(init.cost);
  const parts = [];

  if (qty > 0) {
    if (firstSellable > 1) {
      parts.push(
        `开局已满仓，且受 T+1 锁定：首个可卖决策日为第 ${firstSellable} 日，此前只能观望或等到解锁后再处理仓位`
      );
    } else {
      parts.push('开局已满仓，首日即可选择卖出或继续持有');
    }
    if (Number.isFinite(cost) && cost > 0) {
      parts.push(`成本价约 ${cost.toFixed(2)}`);
    }
    if (Number.isFinite(cash) && cash === 0) {
      parts.push('现金为 0，窗口内若卖出即转为空仓直至再买（若规则允许）');
    }
  } else {
    parts.push('开局空仓，需要自行选择是否买入、以及何时卖出');
  }

  if (ctx.maxOrders != null && Number.isFinite(Number(ctx.maxOrders))) {
    parts.push(`本关订单上限 ${Number(ctx.maxOrders)} 笔，超出即拒单且不改状态`);
  }

  const hint =
    typeof ctx.openStateHint === 'string' ? ctx.openStateHint.trim() : '';
  // Prefer structured facts; only append hint when it adds a short status cue.
  if (hint && !parts.some((p) => p.includes(hint.slice(0, 6)))) {
    parts.push(hint);
  }

  const theme = typeof ctx.theme === 'string' ? ctx.theme.trim() : '';
  return { parts, theme, qty, firstSellable, maxOrders: ctx.maxOrders ?? null };
}

/**
 * Narrate actual trade path in desk-note style.
 * @param {Array<{type?: string, day?: number, price?: number, return?: number}>|null|undefined} trades
 * @param {{ gameDays?: number|null }} [opts]
 */
export function describeTradePath(trades, opts = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const gameDays = opts.gameDays != null ? Number(opts.gameDays) : null;
  if (!list.length) {
    return gameDays != null && Number.isFinite(gameDays)
      ? `整段 ${gameDays} 日窗口内没有成交，仓位路径与开局状态一路带到末日估值。`
      : '整段窗口内没有成交，仓位路径与开局状态一路带到末日估值。';
  }

  const bits = list.map((t) => {
    const kind = t.type === 'buy' ? '买入' : t.type === 'sell' ? '卖出' : String(t.type || '成交');
    const day = t.day != null ? `第 ${t.day} 日` : '某日';
    const px =
      t.price != null && Number.isFinite(Number(t.price))
        ? `，成交价 ${Number(t.price).toFixed(2)}`
        : '';
    return `${day}${kind}${px}`;
  });

  let path = `实际成交 ${list.length} 笔：${bits.join('；')}。`;
  if (gameDays != null && Number.isFinite(gameDays)) {
    path += `末日（第 ${gameDays} 日）仅估值、不可再下单，最终收益以收盘价盯市为准。`;
  } else {
    path += '末日仅估值、不可再下单，最终收益以收盘价盯市为准。';
  }
  return path;
}

/**
 * 本关情境叙述 — 1–2 measured paragraphs (template + facts).
 * Does not dump teachingBrief slogans; may weave theme as scene label.
 * @param {{
 *   theme?: string|null,
 *   teachingBrief?: string|null,
 *   openStateHint?: string|null,
 *   initialState?: object|null,
 *   maxOrders?: number|null,
 *   tradeHistory?: array,
 *   gameDays?: number|null,
 *   puzzleResult?: object|null,
 * }} input
 */
export function formatSituationNarrative(input = {}) {
  const open = describeOpenSituation({
    initialState: input.initialState,
    openStateHint: input.openStateHint,
    maxOrders: input.maxOrders,
    theme: input.theme,
  });
  const tradePath = describeTradePath(input.tradeHistory, {
    gameDays: input.gameDays,
  });

  const themeLead =
    open.theme
      ? `本关情境是「${open.theme}」。`
      : '本关是短窗残局，从既定开局仓位接到窗口结束。';

  const openSentence = open.parts.length
    ? open.parts.join('；') + '。'
    : '';

  const p1 = `${themeLead}${openSentence}${tradePath}`;

  const pr = input.puzzleResult || null;
  const compare = pr ? formatBuyHoldCompare(pr) : null;
  const stars = pr ? formatStarBreakdown(pr) : null;

  const p2Chunks = [];
  if (compare) {
    p2Chunks.push(
      `净值路径相对买持的差额约 ${compare.edgePp}pp（你 ${compare.yourReturnPct}% / 买持 ${compare.buyHoldReturnPct}%）`
    );
  }
  if (stars) {
    p2Chunks.push(stars.paragraph.replace(/^本关记/, '星级上，本关记').replace(/。$/, ''));
  } else if (
    typeof input.teachingBrief === 'string' &&
    input.teachingBrief.trim()
  ) {
    // Soft scene cue only — strip coach-y stock phrases if present.
    const brief = input.teachingBrief
      .trim()
      .replace(/关键(是|在于)/g, '重点在')
      .replace(/记住[：:]?/g, '')
      .replace(/值得注意的是/g, '')
      .replace(/。$/, '');
    if (brief && !/应止损|完美操作|加油/.test(brief)) {
      p2Chunks.push(brief);
    }
  }

  const paragraphs = [p1];
  if (p2Chunks.length) {
    paragraphs.push(p2Chunks.join('。') + '。');
  }
  return paragraphs.filter(Boolean);
}

/** Classic BS is for ~30-day sim; short puzzle windows do not use it. */
export const PUZZLE_BS_NOTE =
  '短窗残局不套用经典 BS / 波段评分；下方以相对买持与星级约束复盘。';

/**
 * Full debrief payload for result screen + settle modal「复盘」section.
 * @param {{
 *   status?: 'pending'|'ok'|'fail',
 *   puzzleResult?: object|null,
 *   saveError?: string|null,
 *   theme?: string|null,
 *   teachingBrief?: string|null,
 *   openStateHint?: string|null,
 *   initialState?: object|null,
 *   maxOrders?: number|null,
 *   tradeHistory?: array,
 *   gameDays?: number|null,
 * }} input
 */
export function formatPuzzleDebrief(input = {}) {
  const status = input.status || (input.puzzleResult ? 'ok' : 'pending');

  if (status === 'pending') {
    return {
      status: 'pending',
      sectionTitle: '复盘',
      buyHoldCompare: null,
      starBreakdown: null,
      situationParagraphs: [
        '结算保存完成后，这里会对照买入持有、拆开星级条件，并按本关开局仓位与实际成交写一段窗口内的路径说明。',
      ],
      bsNote: PUZZLE_BS_NOTE,
      failNote: null,
    };
  }

  if (status === 'fail') {
    const err = input.saveError ? String(input.saveError) : null;
    return {
      status: 'fail',
      sectionTitle: '复盘',
      buyHoldCompare: null,
      starBreakdown: null,
      situationParagraphs: [
        err
          ? `云端进度未能写入（${err}）。本地仍可看 K 线与成交记录；星级与韭币以服务器确认后为准。`
          : '云端进度未能写入。本地仍可看 K 线与成交记录；星级与韭币以服务器确认后为准。',
      ],
      bsNote: PUZZLE_BS_NOTE,
      failNote: err,
    };
  }

  const pr = input.puzzleResult || {};
  const buyHoldCompare = formatBuyHoldCompare(pr);
  const starBreakdown = formatStarBreakdown(pr);
  const situationParagraphs = formatSituationNarrative({
    theme: input.theme,
    teachingBrief: input.teachingBrief,
    openStateHint: input.openStateHint,
    initialState: input.initialState,
    maxOrders: input.maxOrders ?? pr.maxOrders,
    tradeHistory: input.tradeHistory,
    gameDays: input.gameDays,
    puzzleResult: pr,
  });

  return {
    status: 'ok',
    sectionTitle: '复盘',
    buyHoldCompare,
    starBreakdown,
    situationParagraphs,
    bsNote: PUZZLE_BS_NOTE,
    failNote: null,
  };
}
