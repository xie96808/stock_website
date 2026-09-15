/** F02 残局挑战 (ch1/ch2) — hub entry card + dedicated #puzzleScreen */
import { getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { loadCloudGameDraft, clearCloudGameDraft } from './cloud-draft.js';
import { abandonCloudGame } from './game-sync.js';
import {
  Route,
  prepareScreen,
  activateScreen,
  deactivateScreen,
  setHeaderChrome,
} from './screen-router.js';
import { formatLevelGoalLines } from './puzzle-goals-copy.js';
import { amountWithCoinHtml } from './jiu-coin.js';

const ENTRY_TIMEOUT_MS = 20000;

let puzzleEnabled = false;
let puzzleWeeklyEnabled = false;
let chapterCache = null;
let activeChapterId = 'ch1';
let confirmResolver = null;

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
    puzzleWeeklyEnabled = !!(json?.data?.features?.puzzleWeekly);
  } catch {
    puzzleEnabled = false;
    puzzleWeeklyEnabled = false;
  }
  syncWeeklyUiVisibility();
  return puzzleEnabled;
}

export function isPuzzleWeeklyEnabled() {
  return puzzleWeeklyEnabled;
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
      if (meta) meta.textContent = '残局 · 准备中';
      if (stateEl) stateEl.textContent = chapterCache.message || '残局准备中';
      return;
    }
    const summary = chapterProgressSummary(chapterCache);
    if (meta) meta.textContent = '第一、二章已开放 · 首局免费 · 重开 10 韭币 · 二星 +20 / 三星 +15';
    if (stateEl) {
      stateEl.textContent = `进度 ${summary.cleared}/${summary.total} 达二星 · 星 ${summary.starsEarned}/${summary.starsMax} · 已领 ${chapterCache.reward?.grantedCount || 0} 次首通`;
    }
  } catch {
    if (stateEl) stateEl.textContent = '残局加载失败';
  }
}

/** Hub card → L3 章节选择（与玩法三级同构）. */
export function onPuzzleChapterCardClick() {
  if (!puzzleEnabled) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后可保存残局进度与领取首通奖励', 'error');
    openAuthModal?.();
    return;
  }
  if (typeof window.showPuzzleChapters === 'function') {
    window.showPuzzleChapters();
    return;
  }
  // Fallback if home-ia not wired yet
  showPuzzleScreen();
}

/** L3 chapter card → open chapter levels (ch1/ch2; ch3 soon). */
export function onPuzzleChapterSelect(chapterIndex) {
  const idx = Number(chapterIndex) || 0;
  if (idx !== 1 && idx !== 2) {
    showToast('该章节即将推出', 'error');
    return;
  }
  if (!puzzleEnabled) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后可保存残局进度与领取首通奖励', 'error');
    openAuthModal?.();
    return;
  }
  activeChapterId = idx === 2 ? 'ch2' : 'ch1';
  showPuzzleScreen();
}

export async function showPuzzleScreen() {
  prepareScreen(Route.PUZZLE);
  const screen = ensurePuzzleScreen();
  activateScreen(Route.PUZZLE);
  const backBtn = screen?.querySelector?.('#puzzleScreenBackBtn');
  if (backBtn) backBtn.textContent = '← 返回章节';
  const titleEl = screen?.querySelector?.('.puzzle-panel-title');
  if (titleEl) {
    titleEl.textContent =
      activeChapterId === 'ch2' ? '残局挑战 · 第二章' : '残局挑战 · 第一章';
  }
  const body = bodyEl();
  if (body) body.innerHTML = '<p class="puzzle-muted">加载关卡…</p>';
  renderProgressPlaceholder();
  try {
    const res = await fetch(`/api/v1/puzzles?chapter=${encodeURIComponent(activeChapterId)}`, {
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
    if (titleEl && chapterCache?.title) titleEl.textContent = chapterCache.title;
    if (chapterCache?.chapterId) activeChapterId = chapterCache.chapterId;
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
  // Prefer L3 chapter menu when leaving level list
  if (typeof window.showPuzzleChapters === 'function') {
    window.showPuzzleChapters();
    return;
  }
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
        <button type="button" class="puzzle-screen-back" id="puzzleScreenBackBtn">← 返回章节</button>
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
      const fee = Number(lv.entryFee) || 0;
      const feeBit = fee > 0 ? `重开 ${fee} 韭币` : '首局免费';
      const granted = lv.firstClearGranted ? '已领二星' : '首通二星 +20';
      const threeBit = lv.threeStarGranted ? '已领三星' : '三星 +15';
      const teaching = lv.teachingBrief
        ? `<div class="puzzle-level-teaching">${escapeHtml(lv.teachingBrief)}</div>`
        : '';
      const hint = lv.openStateHint
        ? `<div class="puzzle-level-hint">${escapeHtml(lv.openStateHint)}</div>`
        : '';
      const goalLines = formatLevelGoalLines(lv.goals);
      const goalsHtml = goalLines.length
        ? `<div class="puzzle-level-goals">${goalLines
            .map((g) => `<div class="puzzle-level-goal">${escapeHtml(g)}</div>`)
            .join('')}</div>`
        : '';
      return `<button type="button" class="puzzle-level-row" data-level="${escapeHtml(lv.levelKey)}" data-entry-fee="${fee}">
        <span class="puzzle-level-idx">${String(lv.levelIndex).padStart(2, '0')}</span>
        <span class="puzzle-level-copy">
          <strong>${escapeHtml(lv.title)}</strong>
          <small>${escapeHtml(lv.theme)} · ${lv.gameDays} 日 · ${feeBit} · ${granted} · ${threeBit}</small>
          ${teaching}
          ${hint}
          ${goalsHtml}
        </span>
        <span class="puzzle-level-stars" aria-label="${best}星">${starsText(best)}</span>
      </button>`;
    })
    .join('');
  const weeklyBtn = puzzleWeeklyEnabled
    ? `<button type="button" class="puzzle-weekly-link" id="puzzleWeeklyBoardBtn">本周同题榜</button>`
    : '';
  body.innerHTML = `
    <div class="puzzle-list-head">
      <p>首局免费 · 结算后再开扣 10 韭币 · 无反悔 · 二星首次 +20（本章最多 120）· 三星首次 +15 · 实盘短窗残局</p>
      ${weeklyBtn}
    </div>
    <div class="puzzle-level-list">${rows}</div>`;
  body.querySelectorAll('.puzzle-level-row').forEach((btn) => {
    btn.addEventListener('click', () =>
      startPuzzleLevel(btn.getAttribute('data-level'), {
        entryFee: Number(btn.getAttribute('data-entry-fee')) || 0,
      })
    );
  });
  const wb = body.querySelector('#puzzleWeeklyBoardBtn');
  if (wb) wb.addEventListener('click', () => showPuzzleWeeklyBoard());
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
async function enterPuzzleGameScreen(game, { forceFresh = false } = {}) {
  const startGame = resolveStartGame();
  if (!startGame) {
    throw new Error('开局函数未就绪');
  }
  if (!Array.isArray(game?.bars) || !game.bars.length) {
    throw new Error('残局行情快照缺失，无法进入模拟盘');
  }
  const auth = getAuthState();
  const decisionDays = Number.isInteger(game.decisionDays)
    ? game.decisionDays
    : Math.max(1, (Number(game.gameDays) || game.bars.length) - 1);
  let resumeActions = null;
  if (!forceFresh) {
    const draft = loadCloudGameDraft({
      gameId: game.gameId,
      userId: auth?.user?.id,
    });
    if (draft && Array.isArray(draft.actions) && draft.actions.length) {
      // Terminal / hung local draft would leave only「结束并结算」— start day 1 instead.
      if (draft.actions.length >= decisionDays) {
        clearCloudGameDraft(game.gameId);
      } else {
        resumeActions = draft.actions;
      }
    }
  } else if (game.gameId) {
    clearCloudGameDraft(game.gameId);
  }
  await startGame({ cloud: game, resumeActions });
  const gameEl = document.getElementById('gameScreen');
  if (!(gameEl && gameEl.classList.contains('active'))) {
    throw new Error('未能进入模拟盘');
  }
}

async function abandonThenRetry(levelKey, activeGameId) {
  if (activeGameId) {
    try {
      await abandonCloudGame(activeGameId);
    } catch (e) {
      // Still try a fresh entry; server may have already cleared the session.
      console.warn('abandon before puzzle entry failed', e);
    }
  }
  return startPuzzleLevel(levelKey, { afterAbandon: true });
}

async function startPuzzleLevel(levelKey, { afterAbandon = false, entryFee = null } = {}) {
  const body = bodyEl();
  let fee = entryFee;
  if (fee == null && chapterCache?.levels) {
    const lv = chapterCache.levels.find((x) => x.levelKey === levelKey);
    fee = Number(lv?.entryFee) || 0;
  }
  fee = Number(fee) || 0;
  if (fee > 0) {
    const okPay = await askPuzzleRetryConfirm(fee);
    if (!okPay) {
      restoreLevelListUi(bodyEl());
      return;
    }
  }
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
      const activeId = json?.error?.details?.gameId || active?.gameId;
      if (afterAbandon) {
        showToast('放弃后仍有进行中的对局，请稍后重试', 'error');
        restoreLevelListUi(body);
        return;
      }
      if (active?.gameKind === 'puzzle' && Array.isArray(active?.bars) && active.bars.length) {
        const cont = window.confirm(
          '已有进行中的残局对局。\n\n确定：继续原局\n取消：放弃并开新局'
        );
        if (cont) {
          if (!active.levelKey) active.levelKey = levelKey;
          await enterPuzzleGameScreen(active);
          return;
        }
        await abandonThenRetry(levelKey, activeId);
        return;
      }
      const drop = window.confirm(
        (json.error?.message || '已有进行中的云端对局') +
          '\n\n确定：放弃原局并开新残局\n取消：返回关卡列表'
      );
      if (drop) {
        await abandonThenRetry(levelKey, activeId);
        return;
      }
      restoreLevelListUi(body);
      return;
    }
    if (!res.ok) {
      if (json?.error?.code === 'INSUFFICIENT_FUNDS') {
        showToast(json?.error?.message || '韭币不足，无法重开残局', 'error');
      } else {
        showToast(json?.error?.message || '开局失败', 'error');
      }
      restoreLevelListUi(body);
      return;
    }
    const game = json.data?.game;
    if (!game) {
      throw new Error('开局响应缺少对局数据');
    }
    if (json.data?.charged) {
      await refreshMe().catch(() => {});
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

function ensurePuzzleRetryConfirmModal() {
  if (document.getElementById('puzzleRetryConfirmModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'puzzleRetryConfirmModal';
  wrap.className = 'jiu-coin-modal puzzle-retry-confirm-modal';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="jiu-coin-dialog" role="dialog" aria-modal="true" aria-labelledby="puzzleRetryConfirmTitle">
      <button type="button" class="jiu-coin-close-x" id="puzzleRetryConfirmCloseX" aria-label="关闭">×</button>
      <h2 id="puzzleRetryConfirmTitle">再开一局残局</h2>
      <p class="jiu-coin-modal-body" id="puzzleRetryConfirmBody">本关已结算过。再次开局将扣除韭币（首局免费）。</p>
      <p class="daily-challenge-confirm-cost" id="puzzleRetryConfirmCost"></p>
      <div class="jiu-coin-modal-actions">
        <button type="button" class="jiu-coin-secondary" id="puzzleRetryConfirmCancel">取消</button>
        <button type="button" class="jiu-coin-primary" id="puzzleRetryConfirmOk">确认开局</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => resolvePuzzleConfirm(false);
  document.getElementById('puzzleRetryConfirmCancel')?.addEventListener('click', close);
  document.getElementById('puzzleRetryConfirmCloseX')?.addEventListener('click', close);
  document.getElementById('puzzleRetryConfirmOk')?.addEventListener('click', () => resolvePuzzleConfirm(true));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
}

function resolvePuzzleConfirm(ok) {
  const modal = document.getElementById('puzzleRetryConfirmModal');
  if (modal) modal.hidden = true;
  if (!confirmResolver) return;
  const r = confirmResolver;
  confirmResolver = null;
  r(ok);
}

function askPuzzleRetryConfirm(cost) {
  ensurePuzzleRetryConfirmModal();
  const modal = document.getElementById('puzzleRetryConfirmModal');
  const costEl = document.getElementById('puzzleRetryConfirmCost');
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
      document.getElementById('puzzleRetryConfirmOk')?.focus();
    } else {
      resolve(false);
    }
  });
}

function syncWeeklyUiVisibility() {
  const l3 = document.getElementById('puzzleWeeklyL3Card');
  if (l3) l3.hidden = !(puzzleEnabled && puzzleWeeklyEnabled);
}

function ensurePuzzleWeeklyBoardModal() {
  if (document.getElementById('puzzleWeeklyBoardModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'puzzleWeeklyBoardModal';
  wrap.className = 'jiu-coin-modal puzzle-weekly-board-modal';
  wrap.hidden = true;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <div class="jiu-coin-dialog puzzle-weekly-board-dialog" role="dialog" aria-modal="true" aria-labelledby="puzzleWeeklyBoardTitle">
      <button type="button" class="jiu-coin-close-x" id="puzzleWeeklyBoardCloseX" aria-label="关闭">×</button>
      <div class="puzzle-weekly-board" id="puzzleWeeklyBoard">
        <div class="puzzle-weekly-board-head">
          <strong id="puzzleWeeklyBoardTitle">本周同题榜</strong>
        </div>
        <div id="puzzleWeeklyBoardBody"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => hidePuzzleWeeklyBoard();
  document.getElementById('puzzleWeeklyBoardCloseX')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wrap.hidden) close();
  });
}

export function hidePuzzleWeeklyBoard() {
  const modal = document.getElementById('puzzleWeeklyBoardModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

function presetAvatarUrl(entry) {
  const id = entry?.avatarId || 'zodiac-rat';
  return `/images/avatars/${encodeURIComponent(id)}.png`;
}

function avatarUrl(entry) {
  return entry?.avatarUrl || presetAvatarUrl(entry);
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export async function showPuzzleWeeklyBoard() {
  if (!puzzleWeeklyEnabled) {
    showToast('本周同题榜暂未开放', 'error');
    return;
  }
  ensurePuzzleWeeklyBoardModal();
  const modal = document.getElementById('puzzleWeeklyBoardModal');
  const body = document.getElementById('puzzleWeeklyBoardBody');
  const title = document.getElementById('puzzleWeeklyBoardTitle');
  if (modal) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }
  if (body) body.innerHTML = '<p class="puzzle-muted">加载中…</p>';
  try {
    const res = await fetch('/api/v1/puzzles/weekly/board', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body) {
        body.innerHTML = `<p class="puzzle-muted">${escapeHtml(json?.error?.message || '加载失败')}</p>`;
      }
      return;
    }
    const data = json.data || {};
    const lv = data.level;
    if (title) {
      title.textContent = data.ready
        ? `本周同题榜 · ${data.weekId}${lv?.title ? ' · ' + lv.title : ''}`
        : '本周同题榜';
    }
    if (!data.ready) {
      if (body) body.innerHTML = `<p class="puzzle-muted">${escapeHtml(data.message || '准备中')}</p>`;
      return;
    }
    const mineBit = data.mine
      ? `<p class="puzzle-weekly-mine">我的最佳：收益 ${escapeHtml(String(data.mine.returnPct))}%${
          data.mine.rank != null ? ` · 第 ${data.mine.rank} 名` : ''
        }</p>`
      : '<p class="puzzle-weekly-mine puzzle-muted">本周尚未在同题关卡结算</p>';
    if (!data.entries?.length) {
      if (body) {
        body.innerHTML = `${mineBit}<p class="puzzle-muted">暂无上榜成绩（参与 ${data.total || 0}）· 本周关卡「${escapeHtml(
          lv?.title || lv?.levelKey || ''
        )}」</p>`;
      }
      return;
    }
    const rows = data.entries
      .map((e) => {
        const mdd = e.mddPpm == null ? '—' : (e.mddPpm / 10000).toFixed(2) + '%';
        return `<tr>
          <td>${e.rank}</td>
          <td class="puzzle-weekly-nick-cell">
            <span class="puzzle-weekly-nick-inner">
              <img class="dc-avatar" src="${escapeAttr(avatarUrl(e))}" alt="" loading="lazy" width="28" height="28" onerror="this.onerror=null;this.src='${escapeAttr(presetAvatarUrl(e))}'">
              <span>${escapeHtml(e.nickname || '玩家')}</span>
            </span>
          </td>
          <td>${escapeHtml(String(e.returnPct))}%</td>
          <td>${mdd}</td>
        </tr>`;
      })
      .join('');
    if (body) {
      body.innerHTML = `
        ${mineBit}
        <p class="puzzle-weekly-board-meta">同题「${escapeHtml(lv?.title || '')}」· 上榜 ${data.total} 人 · 最佳收益率↓ · 上海时区 ISO 周</p>
        <table class="puzzle-weekly-table daily-challenge-table">
          <thead><tr><th>名次</th><th>昵称</th><th>收益</th><th>最大回撤</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
  } catch (e) {
    if (body) body.innerHTML = `<p class="puzzle-muted">${escapeHtml(e.message || '加载失败')}</p>`;
  }
}
