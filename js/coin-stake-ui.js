/** 韭币局 result card: 投入 / 盈亏 / 对局费 / 到账. Re-runnable (the server's settlement arrives with the save). */
import { getSession } from './game-session.js';
import { stakeResultView } from './coin-stake-pure.js';

export function paintStakeResult() {
  const box = document.getElementById('stakeResultBox');
  if (!box) return;
  const s = getSession();
  if (s.gameKind !== 'stake') {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const view = stakeResultView(s.stake);
  box.hidden = false;
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
}

export async function afterStakeSettled() {
  paintStakeResult();
  try {
    const { refreshMe } = await import('./auth.js');
    await refreshMe();
  } catch { /* balance chip catches up on the next refresh */ }
}
