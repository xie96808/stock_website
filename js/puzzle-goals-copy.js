/**
 * Pure formatters for F02 puzzle star goals + in-play open-state tips (no DOM).
 */

/**
 * @param {object|null|undefined} goals
 * @returns {string|null}
 */
export function formatTwoStarGoalLine(goals) {
  const beat = goals?.twoStar?.beatBuyHoldPp;
  if (beat == null || !Number.isFinite(Number(beat))) return null;
  const n = Number(beat);
  return `二星：收益比买持好 ≥${n} 个百分点`;
}

/**
 * @param {object|null|undefined} goals
 * @returns {string|null}
 */
export function formatThreeStarGoalLine(goals) {
  const t = goals?.threeStar;
  if (!t || typeof t !== 'object') return null;
  const parts = [];
  if (t.maxMddPct != null && Number.isFinite(Number(t.maxMddPct))) {
    parts.push(`回撤≤${t.maxMddPct}%`);
  }
  if (t.maxOrders != null && Number.isFinite(Number(t.maxOrders))) {
    parts.push(`成交≤${t.maxOrders}笔`);
  }
  if (!parts.length) return null;
  return `三星：${parts.join(' 且')}`;
}

/**
 * List-row / tip lines for 2★ and 3★ (skips missing).
 * @param {object|null|undefined} goals
 * @returns {string[]}
 */
export function formatLevelGoalLines(goals) {
  const lines = [];
  const two = formatTwoStarGoalLine(goals);
  const three = formatThreeStarGoalLine(goals);
  if (two) lines.push(two);
  if (three) lines.push(three);
  return lines;
}

/**
 * Compact in-play reminder: open-state (T+1 / maxOrders) + short goals.
 * @param {{
 *   goals?: object|null,
 *   openStateHint?: string|null,
 *   maxOrders?: number|null,
 * }} input
 * @returns {string|null}
 */
export function formatPuzzlePlayTip(input = {}) {
  const parts = [];
  const hint = typeof input.openStateHint === 'string' ? input.openStateHint.trim() : '';
  if (hint) {
    parts.push(hint);
  } else if (input.maxOrders != null && Number.isFinite(Number(input.maxOrders))) {
    parts.push(`订单上限 ${Number(input.maxOrders)} 笔`);
  }
  const goals = formatLevelGoalLines(input.goals);
  if (goals.length) {
    // Compact: join with · for HUD strip
    parts.push(goals.join(' · '));
  }
  if (!parts.length) return null;
  return parts.join(' · ');
}
