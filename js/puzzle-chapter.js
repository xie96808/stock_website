/** F02 残局挑战首章 — hub card + level list; play enters full #gameScreen */
import { getAuthState, openAuthModal, showToast } from './auth.js';
import { loadCloudGameDraft } from './cloud-draft.js';

let puzzleEnabled = false;
let chapterCache = null;

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
      <p>免费重玩 · 无反悔 · 达二星首次 +20 韭币（本章最多 120）· 开局进入完整模拟盘 K 线</p>
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

function resolveStartGame() {
  if (typeof window.__puzzleStartGame === 'function') return window.__puzzleStartGame;
  if (typeof window.__dailyStartGame === 'function') return window.__dailyStartGame;
  return null;
}

/**
 * Enter classic #gameScreen with puzzle snapshot bars (not hub inline strip).
 */
async function enterPuzzleGameScreen(game) {
  const startGame = resolveStartGame();
  if (!startGame) {
    showToast('开局函数未就绪', 'error');
    return;
  }
  if (!Array.isArray(game?.bars) || !game.bars.length) {
    showToast('残局行情快照缺失，无法进入模拟盘', 'error');
    return;
  }
  hidePuzzlePanel();
  const auth = getAuthState();
  const draft = loadCloudGameDraft({
    gameId: game.gameId,
    userId: auth?.user?.id,
  });
  const resumeActions = draft && Array.isArray(draft.actions) ? draft.actions : null;
  await startGame({ cloud: game, resumeActions });
  const gameEl = document.getElementById('gameScreen');
  if (!(gameEl && gameEl.classList.contains('active'))) {
    throw new Error('未能进入模拟盘');
  }
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
      const active = json?.error?.details?.game;
      if (active?.gameKind === 'puzzle' && Array.isArray(active.bars) && active.bars.length) {
        const ok = window.confirm('已有进行中的残局对局。确定：继续原局');
        if (ok) {
          await enterPuzzleGameScreen(active);
          return;
        }
      }
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
    // Ensure levelKey available for result / replay UX.
    if (!game.levelKey) game.levelKey = levelKey;
    await enterPuzzleGameScreen(game);
    refreshPuzzleChapterCard().catch(() => {});
  } catch (e) {
    showToast(e.message || '开局失败', 'error');
    if (body) renderLevelList(body, chapterCache);
  }
}
