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
  if (t.minReturnPpm != null && Number.isFinite(Number(t.minReturnPpm))) {
    const pct = Number(t.minReturnPpm) / 10000;
    const label = Number.isInteger(pct) ? String(pct) : String(+pct.toFixed(2));
    parts.push(`收益≥${label}%`);
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

/**
 * Remaining days in a short puzzle window (inclusive of today as "in progress").
 * @param {number} currentDay
 * @param {number} gameDays
 * @returns {number}
 */
export function puzzleDaysRemaining(currentDay, gameDays) {
  const cur = Number(currentDay);
  const total = Number(gameDays);
  if (!Number.isFinite(cur) || !Number.isFinite(total)) return 0;
  return Math.max(0, total - cur);
}

/**
 * Puzzle day-strip secondary: "余 N 日" (hidden on classic).
 * @param {number} currentDay
 * @param {number} gameDays
 * @returns {string}
 */
export function formatPuzzleRemainLabel(currentDay, gameDays) {
  const left = puzzleDaysRemaining(currentDay, gameDays);
  if (left <= 0) return '本日结算';
  return `余 ${left} 日`;
}

/**
 * In-play HUD chrome copy for 残局 vs 模拟盘 (view applies; no DOM).
 * @param {{
 *   gameKind?: string|null,
 *   title?: string|null,
 *   theme?: string|null,
 *   currentDay?: number,
 *   gameDays?: number,
 * }} input
 */
export function formatPlayHudChrome(input = {}) {
  const isPuzzle = input.gameKind === 'puzzle';
  const isOneshot = input.gameKind === 'oneshot';
  const isSurvival = input.gameKind === 'survival';
  const isGhost = input.gameKind === 'ghost';
  if (isGhost) {
    const ghostName = input.ghostName || '幽灵选手';
    return {
      isPuzzle: false,
      isOneshot: false,
      isSurvival: false,
      isGhost: true,
      kind: 'ghost',
      badge: '幽灵对局',
      subtitle: `对手 · ${ghostName}`,
      mood: '幽灵对局 · 昨日第一回放',
      dayLead: '第',
      dayUnit: '天',
      remainLabel: '',
      boardKicker: 'GHOST · 幽灵对局',
      stageKicker: '幽灵 · K-LINE',
      stageTitle: '实时走势',
    };
  }
  if (isSurvival) {
    const floatLabel = input.survivalFloat?.label || '相对开局 · 爆仓线 −20%';
    return {
      isPuzzle: false,
      isOneshot: false,
      isSurvival: true,
      isGhost: false,
      kind: 'survival',
      badge: '活过三十日',
      subtitle: floatLabel,
      mood: '生存模式 · 相对开局 −20% 爆仓',
      dayLead: '第',
      dayUnit: '天',
      remainLabel: '',
      boardKicker: 'SURVIVAL · 活过三十日',
      stageKicker: '生存 · K-LINE',
      stageTitle: '实时走势',
    };
  }
  if (isOneshot) {
    const ammo = input.ammo || {};
    const buysLeft = ammo.buysLeft == null ? 1 : ammo.buysLeft;
    const sellsLeft = ammo.sellsLeft == null ? 1 : ammo.sellsLeft;
    return {
      isPuzzle: false,
      isOneshot: true,
      isSurvival: false,
      isGhost: false,
      kind: 'oneshot',
      badge: '一把梭',
      subtitle: `买入剩余 ${buysLeft} · 卖出剩余 ${sellsLeft}`,
      mood: '一把梭 · 各限一买一卖',
      dayLead: '第',
      dayUnit: '天',
      remainLabel: '',
      boardKicker: 'ONESHOT · 一把梭',
      stageKicker: '一把梭 · K-LINE',
      stageTitle: '实时走势',
    };
  }
  if (!isPuzzle) {
    return {
      isPuzzle: false,
      isOneshot: false,
      isSurvival: false,
      isGhost: false,
      kind: 'classic',
      badge: '模拟盘',
      subtitle: '',
      mood: null, // view keeps rotating MOODS
      dayLead: '第',
      dayUnit: '天',
      remainLabel: '',
      boardKicker: 'SOUL PORTFOLIO',
      stageKicker: 'MARKET · K-LINE',
      stageTitle: '实时走势',
    };
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const theme = typeof input.theme === 'string' ? input.theme.trim() : '';
  const subtitle = [title, theme].filter(Boolean).join(' · ') || '残局挑战';
  return {
    isPuzzle: true,
    isOneshot: false,
    isSurvival: false,
    isGhost: false,
    kind: 'puzzle',
    badge: '残局',
    subtitle,
    mood: '残局挑战 · 对照星级目标出手',
    dayLead: '窗口',
    dayUnit: '日',
    remainLabel: formatPuzzleRemainLabel(input.currentDay, input.gameDays),
    boardKicker: 'PUZZLE · 残局',
    stageKicker: '残局 · K-LINE',
    stageTitle: '短窗走势',
  };
}

