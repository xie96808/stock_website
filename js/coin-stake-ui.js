import { getSession } from './game-session.js';
import { stakeResultView } from './coin-stake-pure.js';
import { coinIconHtml } from './icon-art.js';

/**
 * 韭币局结算明细放在弹窗里：主页面只突出收益率。
 * - 结算出结果后自动弹出一次；
 * - 关掉后，等级标题旁的韭币图标（#stakeInfoBtn）可以随时再打开。
 */
let wired = false;
let autoShownKey = null;
let lastFocus = null;

const modalEl = () => document.getElementById('stakeResultModal');

export function isStakeResultModalOpen() {
  const m = modalEl();
  return !!m && !m.hidden;
}

export function openStakeResultModal() {
  const m = modalEl();
  const box = document.getElementById('stakeResultBox');
  if (!m || !box || box.hidden) return;
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  m.hidden = false;
  m.setAttribute('aria-hidden', 'false');
  const close = m.querySelector('[data-stake-result-close]');
  if (close instanceof HTMLElement) close.focus({ preventScroll: true });
}

export function closeStakeResultModal() {
  const m = modalEl();
  if (!m || m.hidden) return;
  m.hidden = true;
  m.setAttribute('aria-hidden', 'true');
  const back = document.getElementById('stakeInfoBtn');
  const target = lastFocus && document.contains(lastFocus) ? lastFocus : back;
  lastFocus = null;
  if (target instanceof HTMLElement && !target.hidden) target.focus({ preventScroll: true });
}

function wireOnce() {
  if (wired) return;
  const m = modalEl();
  const btn = document.getElementById('stakeInfoBtn');
  if (!m || !btn) return;
  wired = true;
  btn.innerHTML = coinIconHtml({ size: 18 });
  btn.addEventListener('click', openStakeResultModal);
  m.addEventListener('click', (e) => {
    if (e.target === m || (e.target instanceof Element && e.target.closest('[data-stake-result-close]'))) closeStakeResultModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isStakeResultModalOpen()) closeStakeResultModal();
  });
}

export function paintStakeResult() {
  const box = document.getElementById('stakeResultBox');
  if (!box) return;
  wireOnce();
  const btn = document.getElementById('stakeInfoBtn');
  const s = getSession();
  if (s.gameKind !== 'stake') {
    box.hidden = true;
    box.innerHTML = '';
    if (btn) btn.hidden = true;
    closeStakeResultModal();
    autoShownKey = null;
    return;
  }
  const view = stakeResultView(s.stake);
  box.hidden = false;
  if (btn) btn.hidden = false;
  if (!view) {
    // Not settled yet (save in flight / retrying): say so instead of showing a wrong number.
    const amount = s.stake && s.stake.amount;
    box.innerHTML =
      '<div class="stake-result-head">韭币局 · 结算中</div>' +
      '<p class="stake-result-wait">' + (amount ? '投入 ' + amount + ' 韭币，' : '') + '正在核对战绩，到账明细稍后显示。</p>';
    return;
  }
  const tone = view.net > 0 ? 'up' : view.net < 0 ? 'down' : '';
  const rows = view.rows
    .map(
      (r) =>
        '<div class="stake-result-row' + (r.tone ? ' is-' + r.tone : '') + '"><span>' + r.label + '</span><b>' + r.value + '</b></div>'
    )
    .join('');
  box.innerHTML =
    '<div class="stake-result-head' + (tone ? ' is-' + tone : '') + '">' + view.headline + '</div>' + rows;
  // 每局只自动弹一次（结算后重画不会再打扰）；之后靠标题旁的图标手动打开。
  const key = String(s.cloudGameId || 'stake'); // 韭币局一定是云端局，每局的 cloudGameId 都不同
  if (autoShownKey !== key) {
    autoShownKey = key;
    openStakeResultModal();
  }
}

export async function afterStakeSettled() {
  paintStakeResult();
  try {
    const { refreshMe } = await import('./auth.js');
    await refreshMe();
  } catch { /* balance chip catches up on the next refresh */ }
}
