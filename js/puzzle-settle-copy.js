/**
 * Pure copy helpers for F02 puzzle settle celebration modal (no DOM).
 */
import {
  formatTwoStarGoalLine,
  formatThreeStarGoalLine,
} from './puzzle-goals-copy.js';

/** @param {unknown} stars @param {{ pending?: boolean }} [opts] */
export function starsGlyph(stars, opts = {}) {
  const pending = !!opts.pending || stars == null || !Number.isFinite(Number(stars));
  if (pending) {
    return { glyph: '…', starN: null, pending: true };
  }
  const starN = Math.max(0, Math.min(3, Math.floor(Number(stars))));
  return {
    glyph: '★'.repeat(starN) + '☆'.repeat(3 - starN),
    starN,
    pending: false,
  };
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
    return {
      status: 'pending',
      title: '残局结算中',
      starsGlyph: '…',
      starN: null,
      headline: '正在保存进度…',
      rewardLine: null,
      rewardAmount: null,
      rewardGranted: false,
      goalLines: [
        '1★ 合法完成结算',
        '2★ 收益优于买入持有（达线可领首通韭币）',
        '3★ 额外看回撤与成交笔数',
      ],
      edgeLine: null,
      hintLine: '星级：1★合法完成；2★达主目标可领首通；3★再加回撤/笔数约束。',
      failNote: null,
    };
  }

  if (status === 'fail') {
    return {
      status: 'fail',
      title: '结算未保存',
      starsGlyph: '…',
      starN: null,
      headline: '云端保存失败',
      rewardLine: null,
      rewardAmount: null,
      rewardGranted: false,
      goalLines: [],
      edgeLine: null,
      hintLine: null,
      failNote: saveError
        ? `进度未能写入：${saveError}。本地复盘仍可用；奖励未发放。`
        : '进度未能写入云端。本地复盘仍可用；奖励未发放。',
    };
  }

  const { glyph, starN } = starsGlyph(pr?.stars, { pending: false });
  const reward = pr?.reward;
  let rewardLine = null;
  let rewardAmount = null;
  let rewardGranted = false;
  if (reward?.grantedThisTime) {
    rewardAmount = Number(reward.amount) || 20;
    rewardGranted = true;
    rewardLine = `首通奖励 +${rewardAmount} 韭币`;
  } else if (reward?.alreadyClaimed) {
    rewardLine = '本关首通韭币已领过';
  } else if (starN != null && starN < 2) {
    rewardLine = '未达二星：首通韭币需 ≥2★';
  }

  let headline = '残局结算';
  if (starN >= 3) headline = '三星通关！';
  else if (starN >= 2) headline = '通关成功 · 已达二星';
  else if (starN >= 1) headline = '合法完成 · 1★';

  const twoLine = formatTwoStarGoalLine(pr?.goals) || '二星：收益优于买入持有';
  const threeLine = formatThreeStarGoalLine(pr?.goals) || '三星：回撤与成交约束';

  const goalLines = [];
  goalLines.push(starN >= 1 ? '✓ 1★ 合法完成' : '○ 1★ 合法完成');
  if (pr?.twoStarMet || starN >= 2) {
    goalLines.push(`✓ ${twoLine}`);
  } else {
    goalLines.push(`○ ${twoLine}`);
  }
  if (pr?.threeStarMet || starN >= 3) {
    goalLines.push(`✓ ${threeLine}`);
  } else {
    goalLines.push(`○ ${threeLine}`);
  }

  return {
    status: 'ok',
    title: `残局结算 · ${glyph}`,
    starsGlyph: glyph,
    starN,
    headline,
    rewardLine,
    rewardAmount,
    rewardGranted,
    goalLines,
    edgeLine: formatEdgeVsBuyHold(pr?.edgePpm),
    hintLine: '关闭后可继续看 K 线复盘；星级已记入残局列表。',
    failNote: null,
  };
}
