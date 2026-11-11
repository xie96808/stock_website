/**
 * 开一局 收益率转轮（DOM 部分）。
 *
 * 开一局进场后顶部卡片的收益率（#rlCardPnl）和结算页的最终收益率（#finalReturn）一变，
 * 数字就像老虎机转轮一样逐位滚动、左边先停。元素的 textContent 始终等于显示的文字
 * （每个 .sp-cell 里只有最终字符；滚动用的字符放在 data-strip 里，由 CSS ::before 画出来），
 * 所以别的代码读 / 写它都不受影响。只在 stake 的页面上生效；prefers-reduced-motion 下不转。
 */
import { reelPlan, reelTotalMs } from './stake-reel-pure.js';

let started = false;
const SETTLE_SLACK_MS = 200;
// 镜像（returns-layout）会在我们渲染后立刻把同样的文字再写一遍；只在这个窗口内把转动补回去，之后的重写一律按静止字符处理
const REPAINT_REARM_MS = 150;

function reduced() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function render(el, plan, still) {
  el.textContent = '';
  for (const c of plan) {
    const cell = document.createElement('span');
    cell.className = 'sp-cell';
    cell.textContent = c.ch;
    if (c.strip && !still) {
      cell.dataset.strip = c.strip.join('\n');
      cell.style.setProperty('--k', String(c.strip.length));
      cell.style.setProperty('--t', `${c.durMs}ms`);
    }
    el.appendChild(cell);
  }
}

/** 转完后把 DOM 收成纯文字（去掉 data-strip）：不依赖 animationend，动画被暂停 / 取消时也能落定。 */
function scheduleSettle(el, plan) {
  clearTimeout(el._spTimer);
  const ms = reelTotalMs(plan) + SETTLE_SLACK_MS;
  if (!(ms > SETTLE_SLACK_MS)) return;
  el._spTimer = setTimeout(() => settle(el), ms);
}

function settle(el) {
  clearTimeout(el._spTimer);
  el._spPlan = null;
  if (!el.querySelector('.sp-cell[data-strip]')) return;
  const cur = (el.textContent || '').trim();
  render(el, reelPlan(cur, cur), true);
}

function handle(el) {
  const cur = (el.textContent || '').trim();
  const hasCells = !!el.querySelector('.sp-cell');
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (cur === el._spLast) {
    // the mirror in returns-layout repaints the same text right after us: put the roll back, but only once and only right away
    if (!hasCells && el._spPlan && now - el._spStart < REPAINT_REARM_MS) {
      render(el, el._spPlan, false);
      return;
    }
    if (!hasCells && cur) render(el, reelPlan(cur, cur), true);
    return;
  }
  const plan = reelPlan(el._spLast ?? '', cur);
  el._spLast = cur;
  el._spPlan = plan;
  el._spStart = now;
  const still = reduced();
  render(el, plan, still);
  if (still) clearTimeout(el._spTimer);
  else scheduleSettle(el, plan);
}

function watch(rootId, selector, stakeClass) {
  const root = document.getElementById(rootId);
  if (!root) return;
  new MutationObserver((muts) => {
    if (!root.classList.contains(stakeClass)) return;
    const el = root.querySelector(selector);
    if (!el || !muts.some((m) => el.contains(m.target))) return;
    handle(el);
  }).observe(root, { childList: true, characterData: true, subtree: true });
}

export function initStakeReel() {
  if (started || typeof document === 'undefined') return;
  started = true;
  watch('gameScreen', '#rlCardPnl', 'game-screen--stake');
  watch('resultScreen', '#finalReturn', 'result-screen--stake');
  // 页面从后台回来 / 从 bfcache 恢复：动画可能被浏览器掐断，直接落定
  const settleAll = () => {
    for (const id of ['rlCardPnl', 'finalReturn']) { const el = document.getElementById(id); if (el) settle(el); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settleAll(); });
  window.addEventListener('pageshow', settleAll);
}
