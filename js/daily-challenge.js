/** F01 每日同题挑战 — hub card + confirm + start/resume/leaderboard */
import { getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { amountWithCoinHtml } from './jiu-coin.js';
import {
  abandonActiveCloudGame,
  loadCloudGameDraft,
} from './game-sync.js';

/** Must match server DAILY_CHALLENGE_COST (classic create stays 20). */
export const DAILY_CHALLENGE_COST_UI = 50;

const MARKETING_LINE = '用完全相同的个股进行游戏！考验你的操作';

const CONFIRM_BODY =
  '你将正式进入今日的挑战。所有玩家将会针对同一个股、同一时间段进行操作。每日排行前三的玩家将会获得丰厚的奖励！特别提醒：每日挑战每天只能进行一次。请珍惜你的机会！';

let dailyChallengeEnabled = false;
let statusCache = null;
let confirmResolver = null;
let startLocked = false;

export function isDailyChallengeEnabled() {
  return dailyChallengeEnabled;
}

export async function refreshDailyChallengeFlag() {
  try {
    const res = await fetch('/api/v1/config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    dailyChallengeEnabled = !!(json?.data?.features?.dailyChallenge);
  } catch {
    dailyChallengeEnabled = false;
  }
  return dailyChallengeEnabled;
}

function cardEl() {
  return document.getElementById('dailyChallengeCard');
}

function boardEl() {
  return document.getElementById('dailyChallengeBoard');
}

function hideSurfaces() {
  const card = cardEl();
  if (card) card.hidden = true;
  const board = boardEl();
  if (board) board.hidden = true;
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `daily-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function dailyApi(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = getAuthState();
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth.csrfToken) h['X-CSRF-Token'] = auth.csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.payload = json;
    err.details = json?.error?.details;
    throw err;
  }
  return { ok: true, status: res.status, data: json.data };
}

function challengeCost(d) {
  const n = Number(d?.cost);
  return Number.isFinite(n) && n > 0 ? n : DAILY_CHALLENGE_COST_UI;
}

function syncCardBadge(cost) {
  const badge = document.querySelector('#dailyChallengeCard .jiu-price-badge');
  if (!badge) return;
  badge.setAttribute('data-jiu-price', String(cost));
  badge.setAttribute('aria-label', `消耗 ${cost} 韭币`);
  badge.innerHTML = amountWithCoinHtml(cost, { size: 12 });
}

export async function refreshDailyChallengeCard() {
  const card = cardEl();
  if (!card) return;
  if (!dailyChallengeEnabled) {
    hideSurfaces();
    return;
  }
  card.hidden = false;
  const meta = document.getElementById('dailyChallengeCardMeta');
  const stateEl = document.getElementById('dailyChallengeCardState');
  const ctaEl = document.getElementById('dailyChallengeCardCta');
  try {
    statusCache = (await dailyApi('/daily-challenge')).data;
  } catch (e) {
    if (e.code === 'DAILY_CHALLENGE_DISABLED' || e.status === 404) {
      dailyChallengeEnabled = false;
      hideSurfaces();
      return;
    }
    if (stateEl) stateEl.textContent = '状态加载失败，点此重试';
    if (ctaEl) ctaEl.textContent = '重试';
    return;
  }

  const d = statusCache;
  const cost = challengeCost(d);
  syncCardBadge(cost);
  if (meta) {
    meta.textContent = MARKETING_LINE;
  }

  if (!d.ready) {
    card.classList.add('is-disabled');
    if (stateEl) stateEl.textContent = d.message || '今日挑战准备中';
    if (ctaEl) ctaEl.textContent = '稍后再来';
    return;
  }
  card.classList.remove('is-disabled');

  if (d.activeGame) {
    if (stateEl) stateEl.textContent = '进行中 · 可继续（不扣币）';
    if (ctaEl) ctaEl.textContent = '继续挑战';
  } else if (d.attempt && (d.attempt.status === 'settled' || d.attempt.status === 'settle_late')) {
    const ppm = d.attempt.returnPpm;
    const pct = ppm == null ? '—' : (ppm / 10000).toFixed(2) + '%';
    if (stateEl) stateEl.textContent = `已结算 · 收益 ${pct}`;
    if (ctaEl) ctaEl.textContent = '查看日榜';
  } else if (d.remainingChance === 0) {
    if (stateEl) stateEl.textContent = '今日机会已用完';
    if (ctaEl) ctaEl.textContent = '查看日榜';
  } else {
    if (stateEl) stateEl.textContent = '剩余正式机会 1 次 · 无反悔';
    if (ctaEl) ctaEl.textContent = '开始今日挑战';
  }
}

function ensureConfirmModal() {
  if (document.getElementById('dailyChallengeConfirmModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'dailyChallengeConfirmModal';
  wrap.className = 'jiu-coin-modal daily-challenge-confirm-modal';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="jiu-coin-dialog" role="dialog" aria-modal="true" aria-labelledby="dailyChallengeConfirmTitle">
      <button type="button" class="jiu-coin-close-x" id="dailyChallengeConfirmCloseX" aria-label="关闭">×</button>
      <h2 id="dailyChallengeConfirmTitle">开始今日挑战</h2>
      <p class="jiu-coin-modal-body" id="dailyChallengeConfirmBody"></p>
      <p class="daily-challenge-confirm-cost" id="dailyChallengeConfirmCost"></p>
      <div class="jiu-coin-modal-actions">
        <button type="button" class="jiu-coin-secondary" id="dailyChallengeConfirmCancel">取消</button>
        <button type="button" class="jiu-coin-primary" id="dailyChallengeConfirmOk">开始游戏</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => resolveConfirm(false);
  document.getElementById('dailyChallengeConfirmCancel')?.addEventListener('click', close);
  document.getElementById('dailyChallengeConfirmCloseX')?.addEventListener('click', close);
  document.getElementById('dailyChallengeConfirmOk')?.addEventListener('click', () => resolveConfirm(true));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
}

function resolveConfirm(ok) {
  const modal = document.getElementById('dailyChallengeConfirmModal');
  if (modal) modal.hidden = true;
  if (!confirmResolver) return;
  const r = confirmResolver;
  confirmResolver = null;
  r(ok);
}

function askFreshStartConfirm(cost) {
  ensureConfirmModal();
  const modal = document.getElementById('dailyChallengeConfirmModal');
  const body = document.getElementById('dailyChallengeConfirmBody');
  const costEl = document.getElementById('dailyChallengeConfirmCost');
  if (body) body.textContent = CONFIRM_BODY;
  const auth = getAuthState();
  const bal = auth?.user?.jiuCoinBalance;
  const balBit =
    bal == null || Number.isNaN(Number(bal))
      ? ''
      : ` · 当前余额 ${amountWithCoinHtml(bal, { size: 14 })}`;
  if (costEl) {
    costEl.innerHTML = `本次消耗 ${amountWithCoinHtml(cost, { size: 14 })}${balBit}`;
  }
  return new Promise((resolve) => {
    confirmResolver = resolve;
    if (modal) {
      modal.hidden = false;
      document.getElementById('dailyChallengeConfirmOk')?.focus();
    } else {
      resolve(false);
    }
  });
}

function fillModalEl() {
  return document.getElementById('fillModeModal');
}

function setFillProgress(pct, tip) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const fill = document.getElementById('fillLoadFill');
  const bar = document.getElementById('fillLoadBar');
  const pctEl = document.getElementById('fillLoadPct');
  const tipEl = document.getElementById('fillLoadTip');
  if (fill) fill.style.width = p + '%';
  if (bar) bar.setAttribute('aria-valuenow', String(p));
  if (pctEl) pctEl.textContent = p + '%';
  if (tipEl && tip) tipEl.textContent = tip;
}

function showFillLoadingOnly() {
  const modal = fillModalEl();
  if (!modal) return;
  const choose = document.getElementById('fillModeChoosePane');
  const loading = document.getElementById('fillModeLoadingPane');
  const conflict = document.getElementById('fillModeConflictPane');
  const title = document.getElementById('fillModeDialogTitle');
  if (choose) choose.hidden = true;
  if (conflict) conflict.hidden = true;
  if (loading) loading.hidden = false;
  if (title) title.textContent = '正在开局';
  modal.classList.add('is-loading');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  setFillProgress(6, '准备今日挑战…');
}

function closeFillModal() {
  const modal = fillModalEl();
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-loading');
  const choose = document.getElementById('fillModeChoosePane');
  const loading = document.getElementById('fillModeLoadingPane');
  const conflict = document.getElementById('fillModeConflictPane');
  if (choose) choose.hidden = false;
  if (loading) loading.hidden = true;
  if (conflict) conflict.hidden = true;
  setFillProgress(0, '股票资源加载中…');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCloudFromMeta(cloud) {
  const runner =
    typeof window.__dailyStartGame === 'function'
      ? window.__dailyStartGame
      : typeof window.startGame === 'function'
        ? window.startGame
        : null;
  if (!runner) {
    showToast('开局函数未就绪', 'error');
    return;
  }
  const { ensureStocksLoaded } = await import('./pack-store.js');
  const { gameState } = await import('./state.js');
  await ensureStocksLoaded(gameState);
  const auth = getAuthState();
  const draft = loadCloudGameDraft({
    gameId: cloud.gameId,
    userId: auth?.user?.id,
  });
  const resumeActions = draft && Array.isArray(draft.actions) ? draft.actions : null;
  if (typeof window.__dailyStartGame === 'function') {
    await window.__dailyStartGame({ cloud, resumeActions });
  } else {
    await runner({ cloud, resumeActions });
  }
}

async function createOrResumeDaily() {
  const key = newIdempotencyKey();
  const data = (
    await dailyApi('/daily-challenge/games', {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': key },
    })
  ).data;
  return data.game;
}

/** Fresh start: confirm → progress bar → create → enter game. */
async function runFreshDailyStart() {
  const cost = challengeCost(statusCache);
  const ok = await askFreshStartConfirm(cost);
  if (!ok) return;

  showFillLoadingOnly();
  try {
    setFillProgress(18, '创建今日挑战…');
    const { ensureStocksLoaded, packReady } = await import('./pack-store.js');
    const { gameState } = await import('./state.js');
    const packPromise = ensureStocksLoaded(gameState, (ratio) => {
      setFillProgress(18 + Math.max(0, Math.min(1, ratio)) * 50, '股票资源加载中…');
    });
    const createPromise = createOrResumeDaily();
    const [game] = await Promise.all([createPromise, packPromise]);
    setFillProgress(packReady() ? 88 : 92, '进入模拟盘…');
    await refreshMe().catch(() => {});
    await startCloudFromMeta(game);
    setFillProgress(100, '即将进入…');
    await delay(60);
    closeFillModal();
    await refreshDailyChallengeCard();
  } catch (e) {
    closeFillModal();
    throw e;
  }
}

async function handleActiveConflict(activeGame) {
  const kind = activeGame.gameKind === 'daily' ? '今日挑战' : '经典练习';
  const okContinue = window.confirm(
    `已有进行中的云端对局（${kind}）。\n\n确定：继续原局\n取消：可再选是否放弃原局后新开今日挑战`
  );
  if (okContinue) {
    await startCloudFromMeta(activeGame);
    return;
  }
  const okAbandon = window.confirm(
    '要放弃当前云端对局并开启今日挑战吗？放弃不退韭币；若原局也是今日挑战，今日机会不恢复。'
  );
  if (!okAbandon) return;
  await abandonActiveCloudGame();
  await runFreshDailyStart();
}

export async function onDailyChallengeCardClick() {
  if (!dailyChallengeEnabled || startLocked) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后才能参加今日挑战', 'error');
    openAuthModal('login');
    return;
  }

  if (!statusCache || !statusCache.ready) {
    await refreshDailyChallengeCard();
  }
  const d = statusCache;
  if (!d?.ready) {
    showToast(d?.message || '今日挑战准备中', 'error');
    return;
  }

  // Resume: no first-time confirm (chance already consumed).
  if (d.activeGame) {
    await startCloudFromMeta(d.activeGame);
    return;
  }

  if (d.remainingChance === 0) {
    await showDailyChallengeBoard();
    return;
  }

  startLocked = true;
  try {
    if (d.cloudActiveGame && d.cloudActiveGame.gameKind !== 'daily') {
      await handleActiveConflict(d.cloudActiveGame);
      await refreshMe().catch(() => {});
      await refreshDailyChallengeCard();
      return;
    }
    await runFreshDailyStart();
  } catch (e) {
    if (e.code === 'ACTIVE_GAME_EXISTS' && e.details?.game) {
      await handleActiveConflict(e.details.game);
      return;
    }
    if (e.code === 'INSUFFICIENT_FUNDS') {
      showToast(e.message || '韭币不足', 'error');
      return;
    }
    if (e.code === 'DAILY_CHANCE_USED') {
      showToast(e.message || '今日机会已用完', 'error');
      await showDailyChallengeBoard();
      return;
    }
    showToast(e.message || '开局失败', 'error');
  } finally {
    startLocked = false;
  }
}

function avatarUrl(row) {
  if (!row) return 'images/avatars/01.png';
  if (row.avatarUrl) return row.avatarUrl;
  const n = String(row.avatarId || 1).padStart(2, '0');
  return `images/avatars/${n}.png`;
}

export async function showDailyChallengeBoard() {
  if (!dailyChallengeEnabled) return;
  const board = boardEl();
  if (!board) return;
  board.hidden = false;
  const body = document.getElementById('dailyChallengeBoardBody');
  const title = document.getElementById('dailyChallengeBoardTitle');
  if (body) body.innerHTML = '<p class="daily-challenge-board-loading">加载中…</p>';
  try {
    const data = (await dailyApi('/daily-challenge/leaderboard')).data;
    if (title) {
      title.textContent = data.ready
        ? `今日挑战榜 · ${data.date}${data.boardUnlocked ? '' : '（截止前摘要）'}`
        : '今日挑战榜';
    }
    if (!data.ready) {
      if (body) body.innerHTML = `<p>${data.message || '今日挑战准备中'}</p>`;
      return;
    }
    if (!data.entries?.length) {
      if (body) {
        body.innerHTML = `<p>暂无上榜成绩（参与 ${data.total || 0}）</p>`;
      }
      return;
    }
    const rows = data.entries
      .map((e) => {
        const mdd = e.mddPpm == null ? '—' : (e.mddPpm / 10000).toFixed(2) + '%';
        return `<tr>
          <td>${e.rank}</td>
          <td class="daily-challenge-nick-cell">
            <img class="dc-avatar" src="${escapeAttr(avatarUrl(e))}" alt="" loading="lazy" decoding="async" width="28" height="28">
            <span>${escapeHtml(e.nickname || '玩家')}</span>
          </td>
          <td>${e.returnPct}%</td>
          <td>${mdd}</td>
        </tr>`;
      })
      .join('');
    if (body) {
      body.innerHTML = `
        <p class="daily-challenge-board-meta">上榜 ${data.total} 人 · 收益率↓ / 回撤↑ · 密集排名</p>
        <table class="daily-challenge-table">
          <thead><tr><th>名次</th><th>昵称</th><th>收益</th><th>最大回撤</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
  } catch (e) {
    if (body) body.innerHTML = `<p>${escapeHtml(e.message || '加载失败')}</p>`;
  }
}

export function hideDailyChallengeBoard() {
  const board = boardEl();
  if (board) board.hidden = true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
