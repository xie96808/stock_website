/** F02 残局挑战首章 — hub entry card + dedicated #puzzleScreen */
import { getAuthState, openAuthModal, showToast } from './auth.js';
import { loadCloudGameDraft } from './cloud-draft.js';
import {
  Route,
  prepareScreen,
  activateScreen,
  deactivateScreen,
  setHeaderChrome,
} from './screen-router.js';

const ENTRY_TIMEOUT_MS = 20000;

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

function screenEl() {
  return document.getElementById('puzzleScreen');
}

function bodyEl() {
  return document.getElementById('puzzleScreenBody');
}

function progressEl() {
  return document.getElementById('puzzleProgress');
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
    const summary = chapterProgressSummary(chapterCache);
    if (meta) meta.textContent = '第一章 · 六关免费 · 首通二星 +20 韭币';
    if (stateEl) {
      stateEl.textContent = `进度 ${summary.cleared}/${summary.total} 达二星 · 星 ${summary.starsEarned}/${summary.starsMax} · 已领 ${chapterCache.reward?.grantedCount || 0} 次首通`;
    }
  } catch {
    if (stateEl) stateEl.textContent = '残局加载失败';
  }
}

/** Hub card → dedicated puzzle screen (not inline expand on hub). */
export function onPuzzleChapterCardClick() {
  if (!puzzleEnabled) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后可保存残局进度与领取首通奖励', 'error');
    openAuthModal?.();
    return;
  }
  showPuzzleScreen();
}

export async function showPuzzleScreen() {
  prepareScreen(Route.PUZZLE);
  const screen = ensurePuzzleScreen();
  activateScreen(Route.PUZZLE);
  const body = bodyEl();
  if (body) body.innerHTML = '<p class="puzzle-muted">加载关卡…</p>';
  renderProgressPlaceholder();
  try {
    const res = await fetch('/api/v1/puzzles?chapter=ch1', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body) body.innerHTML = `<p class="puzzle-muted">${json?.error?.message || '加载失败'}</p>`;
      renderProgressBar(null);
      return;
    }
    chapterCache = json.data;
    renderProgressBar(chapterCache);
    if (body) renderLevelList(body, chapterCache);
  } catch (e) {
    if (body) body.innerHTML = `<p class="puzzle-muted">${e.message || '加载失败'}</p>`;
    renderProgressBar(null);
  }
  screen?.scrollIntoView?.({ block: 'start' });
}

export function hidePuzzleScreen() {
  deactivateScreen(Route.PUZZLE);
  if (typeof window.restoreSimShell === 'function') {
    window.restoreSimShell();
    return;
  }
  setHeaderChrome('hidden');
  const start = document.getElementById('startScreen');
  if (start) start.style.display = 'flex';
}

/** @deprecated alias — panel no longer inlines on hub */
export function hidePuzzlePanel() {
  hidePuzzleScreen();
}

function ensurePuzzleScreen() {
  let screen = screenEl();
  if (!screen) {
    screen = document.createElement('section');
    screen.id = 'puzzleScreen';
    screen.className = 'puzzle-screen';
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
    screen.innerHTML = `
    <div class="puzzle-screen-wrap">
      <div class="puzzle-screen-head">
        <button type="button" class="puzzle-screen-back" id="puzzleScreenBackBtn">← 返回模拟盘</button>
        <h2 class="puzzle-panel-title">残局挑战 · 第一章</h2>
      </div>
      <div class="puzzle-progress" id="puzzleProgress" hidden></div>
      <div id="puzzleScreenBody"></div>
    </div>`;
    document.querySelector('.container')?.appendChild(screen);
  }
  const back = screen.querySelector('#puzzleScreenBackBtn');
  if (back) back.onclick = hidePuzzleScreen;
  return screen;
}

function renderProgressPlaceholder() {
  const el = progressEl();
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<div class="puzzle-progress-meta puzzle-muted">章节进度加载中…</div>
    <div class="puzzle-progress-track" aria-hidden="true"><div class="puzzle-progress-fill" style="width:0%"></div></div>`;
}

/**
 * Chapter progress from GET /puzzles data:
 * cleared = levels with bestStars >= 2; stars = sum of bestStars (cap 3 each).
 */
export function chapterProgressSummary(data) {
  const levels = Array.isArray(data?.levels) ? data.levels : [];
  const total = levels.length || 6;
  let cleared = 0;
  let starsEarned = 0;
  for (const lv of levels) {
    const best = Math.max(0, Math.min(3, Number(lv?.progress?.bestStars) || 0));
    starsEarned += best;
    if (best >= 2) cleared += 1;
  }
  const starsMax = total * 3;
  const percent = total ? Math.round((cleared / total) * 100) : 0;
  return { cleared, total, starsEarned, starsMax, percent };
}

function renderProgressBar(data) {
  const el = progressEl();
  if (!el) return;
  if (!data?.levels?.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const s = chapterProgressSummary(data);
  const granted = data.reward?.grantedCount || 0;
  const chapterMax = data.reward?.chapterMax || 120;
  el.hidden = false;
  el.innerHTML = `
    <div class="puzzle-progress-meta">
      <span>关卡 ${s.cleared}/${s.total} 达二星</span>
      <span>星级 ${s.starsEarned}/${s.starsMax}</span>
      <span>首通 ${granted}/${Math.floor(chapterMax / 20) || 6}</span>
      <strong>${s.percent}%</strong>
    </div>
    <div class="puzzle-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent}" aria-label="章节进度 ${s.percent}%">
      <div class="puzzle-progress-fill" style="width:${s.percent}%"></div>
    </div>`;
}

function starsText(n) {
  const s = Math.max(0, Math.min(3, Number(n) || 0));
  return '★'.repeat(s) + '☆'.repeat(3 - s);
}

function renderLevelList(body, data) {
  if (!body) return;
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

function restoreLevelListUi(body) {
  if (!body) return;
  if (chapterCache) {
    renderProgressBar(chapterCache);
    renderLevelList(body, chapterCache);
  } else {
    body.innerHTML = '<p class="puzzle-muted">请返回后重试</p>';
  }
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

async function fetchWithTimeout(url, options = {}, timeoutMs = ENTRY_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error('开局超时，请检查网络后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enter classic #gameScreen with puzzle snapshot bars.
 * Throws on missing bars / start failure so callers always restore the level list.
 */
async function enterPuzzleGameScreen(game) {
  const startGame = resolveStartGame();
  if (!startGame) {
    throw new Error('开局函数未就绪');
  }
  if (!Array.isArray(game?.bars) || !game.bars.length) {
    throw new Error('残局行情快照缺失，无法进入模拟盘');
  }
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
  const body = bodyEl();
  if (body) body.innerHTML = '<p class="puzzle-muted">开局中…</p>';
  const key = `puzzle-${levelKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetchWithTimeout(
      `/api/v1/puzzles/${encodeURIComponent(levelKey)}/entries`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: authHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        }),
        body: '{}',
      }
    );
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && json?.error?.code === 'ACTIVE_GAME_EXISTS') {
      const active = json?.error?.details?.game;
      if (active?.gameKind === 'puzzle') {
        const ok = window.confirm('已有进行中的残局对局。确定：继续原局');
        if (ok) {
          await enterPuzzleGameScreen(active);
          return;
        }
      }
      showToast(json.error?.message || '已有进行中的对局', 'error');
      restoreLevelListUi(body);
      return;
    }
    if (!res.ok) {
      showToast(json?.error?.message || '开局失败', 'error');
      restoreLevelListUi(body);
      return;
    }
    const game = json.data?.game;
    if (!game) {
      throw new Error('开局响应缺少对局数据');
    }
    // Ensure levelKey available for result / replay UX.
    if (!game.levelKey) game.levelKey = levelKey;
    await enterPuzzleGameScreen(game);
    refreshPuzzleChapterCard().catch(() => {});
  } catch (e) {
    showToast(e.message || '开局失败', 'error');
    restoreLevelListUi(body);
  }
}
