/** Pure helpers for the 「继续对局」banner (no DOM / network). */

/** Kinds the banner can resume: normal-mode single-player runs + daily challenge. */
export const RESUMABLE_KINDS = ['classic', 'oneshot', 'survival', 'daily', 'stake'];

export function isResumableActive(active) {
  if (!active || typeof active !== 'object') return false;
  if (!active.gameId || active.status !== 'active') return false;
  const kind = active.gameKind || 'classic';
  return RESUMABLE_KINDS.includes(kind);
}

export function resumeModeLabel(active) {
  const kind = (active && active.gameKind) || 'classic';
  if (kind === 'oneshot') return '一把梭';
  if (kind === 'survival') return '生存模式';
  if (kind === 'daily') return '今日挑战';
  if (kind === 'stake') return '韭币局';
  return '经典练习';
}

export function resumeFillLabel(active) {
  if (!active || (active.gameKind || 'classic') === 'daily') return '';
  return active.fillMode === 'same_close' ? '当日收盘' : '次日开盘';
}

/**
 * Current day shown on the game screen = decided actions + 1 (capped at total).
 * Server state (event-v1) is authoritative; a local draft is only used for legacy-batch (daily).
 * Returns null when unknown (never guess).
 */
export function resumeDay({ state = null, draftActions = null, total = 30 } = {}) {
  const t = Number(state && state.gameDays) || Number(total) || 30;
  if (state && Array.isArray(state.actions)) {
    const n = state.actions.length;
    const day = state.readyToSettle ? t : Math.min(n + 1, t);
    return { day, total: t, ready: !!state.readyToSettle };
  }
  if (Array.isArray(draftActions) && draftActions.length) {
    return { day: Math.min(draftActions.length + 1, t), total: t, ready: false };
  }
  return null;
}

/** Second line of the banner. Never includes stock name/code (identity stays hidden mid-game). */
export function resumeMetaText(active, dayInfo) {
  const parts = [resumeModeLabel(active)];
  const fill = resumeFillLabel(active);
  if (fill) parts.push(fill);
  if (dayInfo) parts.push(`第 ${dayInfo.day}/${dayInfo.total} 天${dayInfo.ready ? ' · 待结算' : ''}`);
  return parts.join(' · ');
}

/**
 * 「已有云端对局」冲突弹窗的进度说明 (M-11). event-v1 games keep every submitted
 * decision on the server, so 继续 resumes from the cloud day — never 第 1 日.
 * Only legacy-batch games (今日挑战) restart the same window from day 1.
 */
export function conflictProgressText(meta) {
  const m = meta || {};
  if (m.draftDay) return '本机进度：已决策 ' + m.decided + ' 日，将从第 ' + m.draftDay + ' 日继续';
  if (m.protocolVersion === 'event-v1') return '本机暂无未提交进度，将按云端已提交的进度继续';
  return '本机暂无未提交进度（将从第 1 日继续同一云端题目）';
}
