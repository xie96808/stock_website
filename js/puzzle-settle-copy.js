/**
 * Pure copy helpers for F02 puzzle settle celebration modal (no DOM).
 */
import {
  formatTwoStarGoalLine,
  formatThreeStarGoalLine,
} from './puzzle-goals-copy.js';

const STAR_ARIA = Object.freeze(['零星', '一星', '二星', '三星']);

/** Strip leading「二星：」「三星：」「N★ 」style prefixes for icon+label rows. */
export function stripStarPrefix(label) {
  return String(label || '')
    .replace(/^[一二三123]★\s*/u, '')
    .replace(/^[二三]星[：:]\s*/u, '')
    .trim();
}

/**
 * Accessible row of filled/empty CSS star icons (`.puzzle-star` / `--on`).
 * @param {unknown} stars
 * @param {{ pending?: boolean, className?: string }} [opts]
 * @returns {{ html: string, glyph: string, starN: number|null, pending: boolean, ariaLabel: string }}
 */
export function renderStarIcons(stars, opts = {}) {
  const pending =
    !!opts.pending || stars == null || !Number.isFinite(Number(stars));
  const className = opts.className || 'puzzle-stars';
  if (pending) {
    return {
      html: `<span class="${className} puzzle-stars--pending" aria-label="星级结算中">…</span>`,
      glyph: '…',
      starN: null,
      pending: true,
      ariaLabel: '星级结算中',
    };
  }
  const starN = Math.max(0, Math.min(3, Math.floor(Number(stars))));
  const ariaLabel = STAR_ARIA[starN] || `${starN}星`;
  const icons = [0, 1, 2]
    .map((i) => {
      const on = i < starN ? ' puzzle-star--on' : '';
      return `<span class="puzzle-star${on}" aria-hidden="true"></span>`;
    })
    .join('');
  return {
    html: `<span class="${className}" role="img" aria-label="${ariaLabel}">${icons}</span>`,
    glyph: '★'.repeat(starN) + '☆'.repeat(3 - starN),
    starN,
    pending: false,
    ariaLabel,
  };
}

/** @param {unknown} stars @param {{ pending?: boolean }} [opts] */
export function starsGlyph(stars, opts = {}) {
  const r = renderStarIcons(stars, opts);
  return { glyph: r.glyph, starN: r.starN, pending: r.pending, ariaLabel: r.ariaLabel };
}

/**
 * Single-star marker for a goal / breakdown row (filled if met).
 * @param {boolean} met
 * @param {string} ariaLabel e.g.「一星」
 */
export function renderGoalStarIcon(met, ariaLabel) {
  const on = met ? ' puzzle-star--on' : '';
  const label = ariaLabel || (met ? '已达成' : '未达成');
  return `<span class="puzzle-star puzzle-star--goal${on}" role="img" aria-label="${label}"></span>`;
}

/** @param {unknown} edgePpm */
export function formatEdgeVsBuyHold(edgePpm) {
  if (edgePpm == null || !Number.isFinite(Number(edgePpm))) return null;
  const pct = (Number(edgePpm) / 10000).toFixed(2);
  const n = Number(pct);
  if (n > 0) return `相对买入持有 +${pct}pp`;
  if (n < 0) return `相对买入持有 ${pct}pp`;
  return '相对买入持有持平';
}

/** @param {object|null|undefined} goals */
export function formatThreeStarSummary(goals) {
  return formatThreeStarGoalLine(goals);
}

/** @param {object|null|undefined} goals */
export function formatTwoStarSummary(goals) {
  return formatTwoStarGoalLine(goals);
}

/**
 * @param {{ met: boolean|null, label: string, ariaLabel: string }} item
 * @returns {string} plain fallback line (no HTML)
 */
function goalItemPlain(item) {
  const mark = item.met === true ? '✓' : item.met === false ? '○' : '·';
  return `${mark} ${item.label}`;
}

/**
 * Build modal copy for pending / ok / fail settle states.
 * @param {{
 *   status?: 'pending'|'ok'|'fail',
 *   puzzleResult?: object|null,
 *   saveError?: string|null,
 * }} input
 */
export function formatPuzzleSettleModal(input = {}) {
  const status = input.status || 'pending';
  const pr = input.puzzleResult || null;
  const saveError = input.saveError || null;

  if (status === 'pending') {
    const goalItems = [
      { met: null, label: '合法完成结算', ariaLabel: '一星条件' },
      {
        met: null,
        label: '收益优于买入持有（达线可领首通韭币）',
        ariaLabel: '二星条件',
      },
      { met: null, label: '额外看回撤与成交笔数', ariaLabel: '三星条件' },
    ];
    return {
      status: 'pending',
      title: '残局结算中',
      starsGlyph: '…',
      starsHtml: renderStarIcons(null, { pending: true }).html,
      starN: null,
      starsAriaLabel: '星级结算中',
      headline: '正在保存进度…',
      rewardLine: null,
      rewardAmount: null,
      rewardGranted: false,
      goalItems,
      goalLines: goalItems.map(goalItemPlain),
      edgeLine: null,
      hintLine: '星级：一星合法完成；二星达主目标可领首通 +20；三星再加回撤/笔数约束并可领 +15。',
      failNote: null,
    };
  }

  if (status === 'fail') {
    return {
      status: 'fail',
      title: '结算未保存',
      starsGlyph: '…',
      starsHtml: renderStarIcons(null, { pending: true }).html,
      starN: null,
      starsAriaLabel: '星级结算中',
      headline: '云端保存失败',
      rewardLine: null,
      rewardAmount: null,
      rewardGranted: false,
      goalItems: [],
      goalLines: [],
      edgeLine: null,
      hintLine: null,
      failNote: saveError
        ? `进度未能写入：${saveError}。本地复盘仍可用；奖励未发放。`
        : '进度未能写入云端。本地复盘仍可用；奖励未发放。',
    };
  }

  const starInfo = renderStarIcons(pr?.stars, { pending: false });
  const { glyph, starN, ariaLabel: starsAriaLabel } = starInfo;
  const reward = pr?.reward;
  const threeReward = pr?.threeStarReward;
  let rewardLine = null;
  let rewardAmount = null;
  let rewardGranted = false;
  const lines = [];
  if (reward?.grantedThisTime) {
    const amt = Number(reward.amount) || 20;
    lines.push(`首通二星 +${amt} 韭币`);
    rewardAmount = (rewardAmount || 0) + amt;
    rewardGranted = true;
  } else if (reward?.alreadyClaimed) {
    lines.push('本关二星首通已领过');
  } else if (starN != null && starN < 2) {
    lines.push('未达二星：首通韭币需 ≥二星');
  }
  if (threeReward?.grantedThisTime) {
    const amt = Number(threeReward.amount) || 15;
    lines.push(`三星奖励 +${amt} 韭币`);
    rewardAmount = (rewardAmount || 0) + amt;
    rewardGranted = true;
  } else if (threeReward?.alreadyClaimed) {
    lines.push('本关三星奖励已领过');
  } else if (starN != null && starN >= 2 && starN < 3) {
    lines.push('达三星可再领 +15 韭币（每关一次）');
  }
  rewardLine = lines.length ? lines.join(' · ') : null;

  let headline = '残局结算';
  if (starN >= 3) headline = '三星通关！';
  else if (starN >= 2) headline = '通关成功 · 已达二星';
  else if (starN >= 1) headline = '合法完成 · 一星';

  const twoRaw = formatTwoStarGoalLine(pr?.goals) || '二星：收益优于买入持有';
  const threeRaw = formatThreeStarGoalLine(pr?.goals) || '三星：回撤与成交约束';
  const twoLabel = stripStarPrefix(twoRaw) || '收益优于买入持有';
  const threeLabel = stripStarPrefix(threeRaw) || '回撤与成交约束';

  const oneMet = starN >= 1;
  const twoMet = !!(pr?.twoStarMet || starN >= 2);
  const threeMet = !!(pr?.threeStarMet || starN >= 3);

  const goalItems = [
    { met: oneMet, label: '合法完成', ariaLabel: oneMet ? '一星已达成' : '一星未达成' },
    {
      met: twoMet,
      label: twoLabel,
      ariaLabel: twoMet ? '二星已达成' : '二星未达成',
    },
    {
      met: threeMet,
      label: threeLabel,
      ariaLabel: threeMet ? '三星已达成' : '三星未达成',
    },
  ];

  return {
    status: 'ok',
    title: '残局结算',
    starsGlyph: glyph,
    starsHtml: starInfo.html,
    starN,
    starsAriaLabel,
    headline,
    rewardLine,
    rewardAmount,
    rewardGranted,
    goalItems,
    goalLines: goalItems.map(goalItemPlain),
    edgeLine: formatEdgeVsBuyHold(pr?.edgePpm),
    hintLine: '关闭后可继续看 K 线复盘；星级已记入残局列表。',
    failNote: null,
  };
}
