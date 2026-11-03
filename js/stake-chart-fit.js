/**
 * 开一局 手机首屏：让 K 线（含下面的成交量带）刚好落在「顶部卡片之下、固定按钮栏之上」，进场不用再往下滑。
 *
 * 算法很简单：图表框高度 = 视口高度 − 图表框顶边（文档坐标）− 固定按钮栏高度 − 一点留白。
 * 结果写进 #gameScreen 的 --sp-chart-h，css/stake-play.css 只在手机宽度下用它；改完高度后让 ECharts 重新量一次尺寸。
 * 只对开一局（game-screen--stake）生效，经典 / 一把梭 / 生存等完全不碰。
 */
import { chartRefs } from './state.js';

export const STAKE_CHART_MIN_PX = 220;
export const STAKE_CHART_MAX_PX = 560;
export const STAKE_CHART_GAP_PX = 8;

/** Pure: how tall the chart frame may be so its bottom edge clears the fixed action bar. */
export function stakeChartHeight({ viewportH, top, actionH, gap = STAKE_CHART_GAP_PX }) {
  const raw = Math.floor(viewportH - top - actionH - gap);
  if (!Number.isFinite(raw)) return STAKE_CHART_MIN_PX;
  return Math.max(STAKE_CHART_MIN_PX, Math.min(STAKE_CHART_MAX_PX, raw));
}

let lastApplied = '';

export function syncStakeChartHeight() {
  const screen = document.getElementById('gameScreen');
  if (!screen || !screen.classList.contains('game-screen--stake')) return;
  const stage = screen.querySelector('.market-stage .chart-stage');
  if (!stage) return;
  const zone = document.querySelector('.action-zone');
  const actionH = zone && getComputedStyle(zone).position === 'fixed' ? Math.ceil(zone.getBoundingClientRect().height) : 0;
  const top = stage.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
  const h = stakeChartHeight({ viewportH: window.innerHeight, top, actionH });
  const next = h + 'px';
  if (lastApplied === next && screen.style.getPropertyValue('--sp-chart-h') === next) return;
  lastApplied = next;
  screen.style.setProperty('--sp-chart-h', next);
  try { chartRefs.klineChart?.resize(); } catch { /* chart not ready yet */ }
}

let started = false;
export function initStakeChartFit() {
  if (started) return;
  started = true;
  window.addEventListener('resize', syncStakeChartHeight, { passive: true });
  window.addEventListener('orientationchange', syncStakeChartHeight, { passive: true });
  const screen = document.getElementById('gameScreen');
  if (screen && typeof MutationObserver === 'function') {
    // the stake class (and the card above the chart) change when a game starts / the HUD repaints
    new MutationObserver(() => syncStakeChartHeight()).observe(screen, { attributes: true, attributeFilter: ['class'] });
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => syncStakeChartHeight());
    const shell = document.getElementById('gameProgressShell');
    const zone = document.querySelector('.action-zone');
    if (shell) ro.observe(shell);
    if (zone) ro.observe(zone);
  }
  syncStakeChartHeight();
}
