/**
 * Phase C 幽灵对局 — entry from day-board + helpers for HUD identity.
 * Flag: features.ghostDuel (GHOST_DUEL_ENABLED). Default off → entry hidden.
 */
import { getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { amountWithCoinHtml } from './jiu-coin.js';
import { abandonActiveCloudGame, loadCloudGameDraft } from './game-sync.js';
import { mustAwaitPackBeforeEnter } from './game-window-seed.js';
import {
  ghostIdentityFromModifiers,
  ghostAvatarSrc,
  ghostReturnAtDecisionCount,
  formatGhostReturnPct,
  GHOST_LABEL,
} from '../shared/ghost.js';

export { ghostIdentityFromModifiers, ghostAvatarSrc, ghostReturnAtDecisionCount, formatGhostReturnPct, GHOST_LABEL };

let ghostDuelEnabled = false;
let previewCache = null;
let startLocked = false;

export function isGhostDuelEnabled() {
  return ghostDuelEnabled;
}

export async function refreshGhostDuelFlag() {
  try {
    const res = await fetch('/api/v1/config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    ghostDuelEnabled = !!(json?.data?.features?.ghostDuel);
  } catch {
    ghostDuelEnabled = false;
  }
  return ghostDuelEnabled;
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ghostApi(path, { method = 'GET', body, headers = {} } = {}) {
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

export async function fetchGhostPreview() {
  if (!ghostDuelEnabled) {
    previewCache = null;
    return null;
  }
  try {
    const { data } = await ghostApi('/daily-challenge/ghost');
    previewCache = data;
    return data;
  } catch (e) {
    if (e.code === 'FEATURE_DISABLED' || e.status === 403) {
      ghostDuelEnabled = false;
    }
    previewCache = null;
    return null;
  }
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

/**
 * Render entry strip into daily board modal body (call after board table HTML).
 * Persistent CTA when ghost available; clear empty state when not.
 */
export function renderGhostDuelEntryHtml(preview) {
  if (!ghostDuelEnabled) return '';
  if (!preview || !preview.available || !preview.ghost) {
    const msg = preview?.message || '昨日暂无幽灵可挑战';
    return `<div class="ghost-duel-entry ghost-duel-entry--empty" id="ghostDuelEntry">
      <span class="ghost-duel-entry__label">${escapeHtml(GHOST_LABEL)}</span>
      <p class="ghost-duel-entry__empty">${escapeHtml(msg)}</p>
    </div>`;
  }
  const g = preview.ghost;
  const src = ghostAvatarSrc(g);
  const preset = `images/avatars/${String(g.avatarId || 1).padStart(2, '0')}.png`;
  const ret =
    g.returnPct != null ? `${Number(g.returnPct) >= 0 ? '+' : ''}${g.returnPct}%` : '—';
  const cost = Number(preview.cost) || 20;
  return `<div class="ghost-duel-entry" id="ghostDuelEntry">
    <div class="ghost-duel-entry__who">
      <img class="ghost-duel-entry__avatar" src="${escapeAttr(src)}" alt="" width="36" height="36"
        loading="lazy" decoding="async"
        onerror="this.onerror=null;this.src='${escapeAttr(preset)}'">
      <div class="ghost-duel-entry__meta">
        <span class="ghost-duel-entry__ribbon">${escapeHtml(GHOST_LABEL)}</span>
        <strong class="ghost-duel-entry__name">${escapeHtml(g.nickname || '幽灵选手')}</strong>
        <span class="ghost-duel-entry__sub">昨日日榜 #1 · 收益 ${escapeHtml(ret)} · ${escapeHtml(preview.sourceDate || '')}</span>
      </div>
    </div>
    <button type="button" class="ghost-duel-entry__cta" id="ghostDuelStartBtn">
      挑战幽灵<span class="jiu-price-badge jiu-price-paid" data-jiu-price="${cost}">${amountWithCoinHtml(cost, { size: 12 })}</span>
    </button>
  </div>`;
}

export function wireGhostDuelEntry(root = document) {
  const btn = root.querySelector?.('#ghostDuelStartBtn') || document.getElementById('ghostDuelStartBtn');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void onGhostDuelStartClick();
  });
}

function fillModalEl() {
  return document.getElementById('fillModeModal');
}

function setFillProgress(p, tip) {
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
  setFillProgress(6, '准备幽灵对局…');
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
  if (mustAwaitPackBeforeEnter(cloud)) {
    await ensureStocksLoaded(gameState);
  } else {
    ensureStocksLoaded(gameState).catch((err) => {
      console.warn('pack load (non-blocking, ghost)', err);
    });
  }
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

async function createOrResumeGhost() {
  const key = newIdempotencyKey();
  const data = (
    await ghostApi('/daily-challenge/ghost/games', {
      method: 'POST',
      body: {},
      headers: { 'Idempotency-Key': key },
    })
  ).data;
  return data.game;
}

async function runFreshGhostStart() {
  const preview = previewCache || (await fetchGhostPreview());
  if (!preview?.available) {
    showToast(preview?.message || '暂无幽灵可挑战', 'error');
    return;
  }
  const g = preview.ghost;
  const cost = Number(preview.cost) || 20;
  const ok = window.confirm(
    `挑战幽灵「${g?.nickname || '昨日第一'}」\n` +
      `将重玩昨日（${preview.sourceDate || '昨日'}）同题，幽灵操作按日回放。\n` +
      `消耗 ${cost} 韭币（不占用今日挑战机会）。\n\n确定开始？`
  );
  if (!ok) return;

  showFillLoadingOnly();
  try {
    setFillProgress(18, '创建幽灵对局…');
    const { ensureStocksLoaded, packReady } = await import('./pack-store.js');
    const { gameState } = await import('./state.js');
    const packPromise = ensureStocksLoaded(gameState, (ratio) => {
      setFillProgress(18 + Math.max(0, Math.min(1, ratio)) * 50, '股票资源加载中…');
    });
    const game = await createOrResumeGhost();
    if (mustAwaitPackBeforeEnter(game)) {
      await packPromise;
      setFillProgress(packReady() ? 88 : 92, '进入模拟盘…');
    } else {
      packPromise.catch((err) => {
        console.warn('pack load (non-blocking, ghost)', err);
      });
      setFillProgress(88, '进入模拟盘…');
    }
    await refreshMe().catch(() => {});
    if (typeof window.hideDailyChallengeBoard === 'function') {
      window.hideDailyChallengeBoard();
    }
    await startCloudFromMeta(game);
    setFillProgress(100, '即将进入…');
    await delay(60);
    closeFillModal();
  } catch (e) {
    closeFillModal();
    throw e;
  }
}

async function handleActiveConflict(activeGame) {
  const kindMap = {
    daily: '今日挑战',
    oneshot: '一把梭',
    survival: '生存模式',
    ghost: '幽灵对局',
  };
  const kind = kindMap[activeGame?.gameKind] || '云端对局';
  const okContinue = window.confirm(
    `已有进行中的云端对局（${kind}）。\n\n确定：继续原局\n取消：可再选是否放弃原局后挑战幽灵`
  );
  if (okContinue) {
    await startCloudFromMeta(activeGame);
    return;
  }
  const okAbandon = window.confirm(
    '要放弃当前云端对局并挑战幽灵吗？放弃不退韭币。'
  );
  if (!okAbandon) return;
  await abandonActiveCloudGame();
  await runFreshGhostStart();
}

export async function onGhostDuelStartClick() {
  if (!ghostDuelEnabled || startLocked) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后才能挑战幽灵', 'error');
    openAuthModal('login');
    return;
  }
  startLocked = true;
  try {
    const preview = await fetchGhostPreview();
    if (!preview?.available) {
      showToast(preview?.message || '暂无幽灵可挑战', 'error');
      return;
    }
    if (preview.cloudActiveGame) {
      await handleActiveConflict(preview.cloudActiveGame);
      return;
    }
    await runFreshGhostStart();
  } catch (e) {
    if (e.code === 'ACTIVE_GAME_EXISTS' && e.details?.game) {
      await handleActiveConflict(e.details.game);
      return;
    }
    showToast(e.message || '开局失败', 'error');
  } finally {
    startLocked = false;
  }
}

/**
 * Sync persistent HUD chip from session modifiers (name + avatar always visible).
 * @param {object} session
 * @param {{ playerReturnPpm?: number|null }} [opts]
 */
export function syncGhostHud(session, opts = {}) {
  const chip = document.getElementById('ghostHudChip');
  if (!chip) return;
  const identity = ghostIdentityFromModifiers(session?.modifiers);
  if (!identity || session?.gameKind !== 'ghost') {
    chip.hidden = true;
    chip.setAttribute('aria-hidden', 'true');
    return;
  }
  chip.hidden = false;
  chip.setAttribute('aria-hidden', 'false');

  const avatarEl = document.getElementById('ghostHudAvatar');
  const nameEl = document.getElementById('ghostHudName');
  const labelEl = document.getElementById('ghostHudLabel');
  const cmpEl = document.getElementById('ghostHudCompare');
  const src = ghostAvatarSrc(identity);
  if (avatarEl) {
    avatarEl.src = src;
    avatarEl.alt = identity.nickname;
    avatarEl.onerror = () => {
      avatarEl.onerror = null;
      avatarEl.src = `images/avatars/${String(identity.avatarId || 1).padStart(2, '0')}.png`;
    };
  }
  if (nameEl) nameEl.textContent = identity.nickname;
  if (labelEl) labelEl.textContent = identity.label || GHOST_LABEL;

  const decisionCount = Array.isArray(session.actions) ? session.actions.length : 0;
  const payload = session.modifiers?.ghost || null;
  const gRet = ghostReturnAtDecisionCount(payload, decisionCount);
  const ghostPpm = gRet?.returnPpm;
  let playerPpm = opts.playerReturnPpm;
  if (playerPpm == null && Number.isFinite(session.totalReturn)) {
    playerPpm = Math.round((session.totalReturn - 1) * 1e6);
  }
  if (cmpEl) {
    const gStr = formatGhostReturnPct(ghostPpm);
    const pStr = formatGhostReturnPct(playerPpm);
    cmpEl.textContent = `你 ${pStr} · 幽灵 ${gStr}`;
  }
}
