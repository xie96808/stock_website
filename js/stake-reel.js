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

function handle(el) {
  const cur = (el.textContent || '').trim();
  const hasCells = !!el.querySelector('.sp-cell');
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (cur === el._spLast) {
    // something repainted the same text (e.g. the mirror in returns-layout) while a roll was running: put the roll back
    if (!hasCells && el._spPlan && now < el._spUntil) render(el, el._spPlan, false);
    return;
  }
  const plan = reelPlan(el._spLast ?? '', cur);
  el._spLast = cur;
  el._spPlan = plan;
  el._spUntil = now + reelTotalMs(plan) + 120;
  render(el, plan, reduced());
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
}
