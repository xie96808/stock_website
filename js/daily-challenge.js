/** F01 每日同题挑战 — hub card + start/resume/leaderboard */
import { getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { amountWithCoinHtml } from './jiu-coin.js';
import {
  abandonActiveCloudGame,
  loadCloudGameDraft,
} from './game-sync.js';

let dailyChallengeEnabled = false;
let statusCache = null;

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
  const costHtml = amountWithCoinHtml(d.cost || 10, { size: 14 });
  if (meta) {
    meta.innerHTML = `${d.date || '今日'} · 次日开盘 · 耗 ${costHtml}`;
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

async function startCloudFromMeta(cloud) {
  const startGame = window.__stockStartGameInner || null;
  // Prefer raw startGame from module binding set at boot; fall back to wrapped window.startGame.
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
  // start-flow wraps window.startGame as modal; __dailyStartGame is the real engine entry.
  if (typeof window.__dailyStartGame === 'function') {
    await window.__dailyStartGame({ cloud, resumeActions });
  } else {
    // If only the modal wrapper exists, it ignores options — call after ensuring pack.
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
  const game = await createOrResumeDaily();
  await startCloudFromMeta(game);
}

export async function onDailyChallengeCardClick() {
  if (!dailyChallengeEnabled) return;
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

  if (d.activeGame) {
    await startCloudFromMeta(d.activeGame);
    return;
  }

  if (d.remainingChance === 0) {
    await showDailyChallengeBoard();
    return;
  }

  try {
    if (d.cloudActiveGame && d.cloudActiveGame.gameKind !== 'daily') {
      await handleActiveConflict(d.cloudActiveGame);
      await refreshMe().catch(() => {});
      await refreshDailyChallengeCard();
      return;
    }
    const game = await createOrResumeDaily();
    await refreshMe().catch(() => {});
    await startCloudFromMeta(game);
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
  }
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
          <td>${escapeHtml(e.nickname || '玩家')}</td>
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
