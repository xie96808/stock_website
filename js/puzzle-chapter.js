/** F02 残局挑战首章 — hub card + level list + short play + result */
import { getAuthState, openAuthModal, showToast } from './auth.js';

let puzzleEnabled = false;
let chapterCache = null;
let playState = null; // { game, level, actions, revealedDay }

export function isPuzzleChapterEnabled() {
  return puzzleEnabled;
}

export async function refreshPuzzleChapterFlag() {
  try {
    const res = await fetch('/api/v1/config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    puzzleEnabled = !!(json?.data?.features?.puzzleChapter);
  } catch {
    puzzleEnabled = false;
  }
  return puzzleEnabled;
}

function cardEl() {
  return document.getElementById('puzzleChapterCard');
}
function panelEl() {
  return document.getElementById('puzzleChapterPanel');
}

function authHeaders(extra = {}) {
  const { csrfToken } = getAuthState();
  const h = { Accept: 'application/json', ...extra };
  if (csrfToken) h['X-CSRF-Token'] = csrfToken;
  return h;
}

export async function refreshPuzzleChapterCard() {
  const card = cardEl();
  if (!card) return;
  if (!puzzleEnabled) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const meta = document.getElementById('puzzleChapterCardMeta');
  const stateEl = document.getElementById('puzzleChapterCardState');
  try {
    const res = await fetch('/api/v1/puzzles?chapter=ch1', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) {
      puzzleEnabled = false;
      card.hidden = true;
      return;
    }
    if (!res.ok) {
      if (stateEl) stateEl.textContent = json?.error?.message || '残局加载失败';
      return;
    }
    chapterCache = json.data;
    if (chapterCache.status === 'preparing' || !chapterCache.levels?.length) {
      if (meta) meta.textContent = '第一章 · 准备中';
      if (stateEl) stateEl.textContent = chapterCache.message || '残局准备中';
      return;
    }
    const cleared = chapterCache.levels.filter((l) => (l.progress?.bestStars || 0) >= 2).length;
    if (meta) meta.textContent = '第一章 · 六关免费 · 首通二星 +20 韭币';
    if (stateEl) {
      stateEl.textContent = `进度 ${cleared}/6 达二星 · 已领 ${chapterCache.reward?.grantedCount || 0} 次首通`;
    }
  } catch {
    if (stateEl) stateEl.textContent = '残局加载失败';
  }
}

export function onPuzzleChapterCardClick() {
  if (!puzzleEnabled) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后可保存残局进度与领取首通奖励', 'error');
    openAuthModal?.();
    return;
  }
  openPuzzlePanel();
}

async function openPuzzlePanel() {
  const panel = panelEl();
  if (!panel) return;
  panel.hidden = false;
  const body = document.getElementById('puzzleChapterPanelBody');
  if (body) body.innerHTML = '<p class="puzzle-muted">加载关卡…</p>';
  try {
    const res = await fetch('/api/v1/puzzles?chapter=ch1', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      body.innerHTML = `<p class="puzzle-muted">${json?.error?.message || '加载失败'}</p>`;
      return;
    }
    chapterCache = json.data;
    renderLevelList(body, chapterCache);
  } catch (e) {
    body.innerHTML = `<p class="puzzle-muted">${e.message || '加载失败'}</p>`;
  }
}

export function hidePuzzlePanel() {
  const panel = panelEl();
  if (panel) panel.hidden = true;
  playState = null;
}

function starsText(n) {
  const s = Math.max(0, Math.min(3, Number(n) || 0));
  return '★'.repeat(s) + '☆'.repeat(3 - s);
}

function renderLevelList(body, data) {
  if (!data?.levels?.length) {
    body.innerHTML = `<p class="puzzle-muted">${data?.message || '残局准备中'}</p>`;
    return;
  }
  const rows = data.levels
    .map((lv) => {
      const best = lv.progress?.bestStars || 0;
      const granted = lv.firstClearGranted ? '已领首通' : '首通二星 +20';
      const note = lv.contentNote ? `<div class="puzzle-level-note">${escapeHtml(lv.contentNote)}</div>` : '';
      return `<button type="button" class="puzzle-level-row" data-level="${escapeHtml(lv.levelKey)}">
        <span class="puzzle-level-idx">${String(lv.levelIndex).padStart(2, '0')}</span>
        <span class="puzzle-level-copy">
          <strong>${escapeHtml(lv.title)}</strong>
          <small>${escapeHtml(lv.theme)} · ${lv.gameDays} 日 · ${granted}</small>
          ${note}
        </span>
        <span class="puzzle-level-stars" aria-label="${best}星">${starsText(best)}</span>
      </button>`;
    })
    .join('');
  body.innerHTML = `
    <div class="puzzle-list-head">
      <p>免费重玩 · 无反悔 · 达二星首次 +20 韭币（本章最多 120）</p>
    </div>
    <div class="puzzle-level-list">${rows}</div>`;
  body.querySelectorAll('.puzzle-level-row').forEach((btn) => {
    btn.addEventListener('click', () => startPuzzleLevel(btn.getAttribute('data-level')));
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function startPuzzleLevel(levelKey) {
  const body = document.getElementById('puzzleChapterPanelBody');
  if (body) body.innerHTML = '<p class="puzzle-muted">开局中…</p>';
  const key = `puzzle-${levelKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetch(`/api/v1/puzzles/${encodeURIComponent(levelKey)}/entries`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders({
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      }),
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && json?.error?.code === 'ACTIVE_GAME_EXISTS') {
      showToast(json.error.message || '已有进行中的对局', 'error');
      renderLevelList(body, chapterCache);
      return;
    }
    if (!res.ok) {
      showToast(json?.error?.message || '开局失败', 'error');
      renderLevelList(body, chapterCache);
      return;
    }
    const game = json.data.game;
    playState = {
      game,
      levelKey,
      actions: [],
      revealedDay: 1,
    };
    renderPlay(body);
  } catch (e) {
    showToast(e.message || '开局失败', 'error');
  }
}

function renderPlay(body) {
  if (!playState || !body) return;
  const g = playState.game;
  const day = playState.actions.length + 1;
  const decisionDays = g.decisionDays || g.gameDays - 1;
  const doneDeciding = playState.actions.length >= decisionDays;
  const init = g.initialState || {};
  const pos =
    init.qty > 0
      ? `持仓中 · 成本 ${Number(init.cost).toFixed(2)} · 首可卖日 D${init.firstSellableDay}`
      : `空仓 · 现金 ${Math.round(init.cash || 0)}`;
  const budget =
    g.maxOrders != null ? `订单预算 ${g.maxOrders}` : '订单不限';
  const acts = playState.actions.map((a, i) => `D${i + 1}:${a}`).join(' · ') || '尚无';
  body.innerHTML = `
    <div class="puzzle-play">
      <button type="button" class="hub-back" id="puzzleBackToList">← 关卡列表</button>
      <h3 class="puzzle-play-title">${escapeHtml(g.stockName || playState.levelKey)}</h3>
      <p class="puzzle-play-meta">${pos} · ${budget} · ${g.gameDays} 日窗口</p>
      <p class="puzzle-play-day">${doneDeciding ? `决策完成，可结算（末日仅估值）` : `决策日 D${day} / ${decisionDays}`}</p>
      <p class="puzzle-play-acts">已选：${escapeHtml(acts)}</p>
      <div class="puzzle-play-actions" ${doneDeciding ? 'hidden' : ''}>
        <button type="button" class="puzzle-act-btn" data-act="buy">买入</button>
        <button type="button" class="puzzle-act-btn" data-act="sell">卖出</button>
        <button type="button" class="puzzle-act-btn" data-act="hold">观望</button>
      </div>
      <div class="puzzle-play-footer">
        <button type="button" class="cta cta-fill" id="puzzleSettleBtn" ${doneDeciding ? '' : 'disabled'}>结算残局</button>
      </div>
    </div>`;
  body.querySelector('#puzzleBackToList')?.addEventListener('click', () => {
    playState = null;
    openPuzzlePanel();
  });
  body.querySelectorAll('.puzzle-act-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (playState.actions.length >= decisionDays) return;
      playState.actions.push(btn.getAttribute('data-act'));
      renderPlay(body);
    });
  });
  body.querySelector('#puzzleSettleBtn')?.addEventListener('click', () => settlePuzzlePlay());
}

async function settlePuzzlePlay() {
  if (!playState) return;
  const body = document.getElementById('puzzleChapterPanelBody');
  const gameId = playState.game.gameId;
  const actions = playState.actions;
  try {
    const res = await fetch(`/api/v1/puzzles/games/${encodeURIComponent(gameId)}/finish`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        actions: actions.map((action, i) => ({ day: i + 1, action })),
        finish: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(json?.error?.message || '结算失败', 'error');
      return;
    }
    renderResult(body, json.data);
    refreshPuzzleChapterCard().catch(() => {});
  } catch (e) {
    showToast(e.message || '结算失败', 'error');
  }
}

function renderResult(body, data) {
  if (!body) return;
  const rewardLine = data.reward?.grantedThisTime
    ? `首通奖励 +${data.reward.amount} 韭币`
    : data.reward?.alreadyClaimed
      ? '本关首通奖励已领取'
      : data.stars >= 2
        ? '已达二星（奖励状态见上）'
        : '未达二星，无首通奖励';
  body.innerHTML = `
    <div class="puzzle-result">
      <button type="button" class="hub-back" id="puzzleBackToList2">← 关卡列表</button>
      <h3>结算 · ${starsText(data.stars)}</h3>
      <p>收益 ${(data.returnPpm / 10000).toFixed(2)}% · 回撤 ${((data.mddPpm || 0) / 10000).toFixed(2)}% · 基准 ${(data.benchmarkReturnPpm / 10000).toFixed(2)}%</p>
      <p>成交 ${data.tradeCount} · 历史最佳 ${starsText(data.bestStars)}</p>
      <p class="puzzle-reward">${rewardLine}</p>
      <button type="button" class="cta cta-fill" id="puzzleReplayBtn">再玩本关</button>
    </div>`;
  const levelKey = data.levelKey || playState?.levelKey;
  playState = null;
  body.querySelector('#puzzleBackToList2')?.addEventListener('click', () => openPuzzlePanel());
  body.querySelector('#puzzleReplayBtn')?.addEventListener('click', () => {
    if (levelKey) startPuzzleLevel(levelKey);
  });
}
