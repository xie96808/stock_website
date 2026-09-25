/**
 * Phase C 幽灵对局 — start flow + HUD identity sync.
 * Flag: features.ghostDuel (GHOST_DUEL_ENABLED). Default off → entry hidden.
 */
import { getAuthState, openAuthModal, showToast, refreshMe } from './auth.js';
import { continueOrAbandonIntraday } from './screen-router.js';
import { abandonActiveCloudGame, loadCloudGameDraft } from './game-sync.js';
import { mustAwaitPackBeforeEnter } from './game-window-seed.js';
import {
  ghostIdentityFromModifiers,
  ghostAvatarSrc,
  ghostReturnAtDecisionCount,
  formatGhostReturnPct,
  ghostRevealAfterPlayerDecisions,
  ghostRevealedActions,
  ghostActionLabelZh,
  GHOST_LABEL,
} from '../shared/ghost.js';
import {
  isGhostDuelEnabled,
  refreshGhostDuelFlag,
  fetchGhostPreview,
  renderGhostDuelEntryHtml,
  wireGhostDuelEntry,
  ghostApi,
  getGhostPreviewCache,
  isGhostStartLocked,
  setGhostStartLocked,
  registerGhostStartHandler,
  previewGhostList,
} from './ghost-duel-entry.js';

export {
  ghostIdentityFromModifiers,
  ghostAvatarSrc,
  ghostReturnAtDecisionCount,
  formatGhostReturnPct,
  ghostRevealAfterPlayerDecisions,
  ghostRevealedActions,
  ghostActionLabelZh,
  GHOST_LABEL,
  isGhostDuelEnabled,
  refreshGhostDuelFlag,
  fetchGhostPreview,
  renderGhostDuelEntryHtml,
  wireGhostDuelEntry,
};

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

async function createOrResumeGhost(ghostGameId) {
  const key = newIdempotencyKey();
  const body = {};
  if (ghostGameId) body.ghostGameId = ghostGameId;
  const data = (
    await ghostApi('/daily-challenge/ghost/games', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key },
    })
  ).data;
  return data.game;
}

async function runFreshGhostStart({ ghostGameId, random = false } = {}) {
  const preview = getGhostPreviewCache() || (await fetchGhostPreview());
  if (!preview?.available) {
    showToast(preview?.message || '暂无幽灵可挑战', 'error');
    return;
  }
  const list = previewGhostList(preview);
  let chosen = null;
  if (ghostGameId) {
    chosen = list.find((g) => g.gameId === ghostGameId) || null;
  }
  if (!chosen) chosen = list[0] || preview.ghost;
  const cost = Number(preview.cost) || 20;
  const verb = random ? '随机挑战' : '挑战';
  const ok = window.confirm(
    `${verb}幽灵「${chosen?.nickname || '昨日选手'}」\n` +
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
    const game = await createOrResumeGhost(chosen?.gameId || ghostGameId || null);
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

async function handleActiveConflict(activeGame, startOpts) {
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
  await runFreshGhostStart(startOpts);
}

export async function onGhostDuelStartClick(opts = {}) {
  if (!isGhostDuelEnabled() || isGhostStartLocked()) return;
  const auth = getAuthState();
  if (!auth?.user) {
    showToast('登录后才能挑战幽灵', 'error');
    openAuthModal('login');
    return;
  }
  setGhostStartLocked(true);
  try {
    const preview = await fetchGhostPreview();
    if (!preview?.available) {
      showToast(preview?.message || '暂无幽灵可挑战', 'error');
      return;
    }
    if (preview.cloudActiveGame) {
      await handleActiveConflict(preview.cloudActiveGame, opts);
      return;
    }
    await runFreshGhostStart(opts);
  } catch (e) {
    if (e.code === 'ACTIVE_GAME_EXISTS' && e.details?.game) {
      await handleActiveConflict(e.details.game, opts);
      return;
    }
    if (e.code === 'ACTIVE_GAME_EXISTS' && e.details?.kind === 'intraday' && e.details.sessionId && !e.details?.game) {
      await continueOrAbandonIntraday(e.details.sessionId);
      return;
    }
    showToast(e.message || '开局失败', 'error');
  } finally {
    setGhostStartLocked(false);
  }
}

registerGhostStartHandler(onGhostDuelStartClick);

/**
 * Sync persistent HUD chip from session modifiers (name + avatar always visible).
 * @param {object} session
 * @param {{ playerReturnPpm?: number|null, flashReveal?: boolean }} [opts]
 */
export function syncGhostHud(session, opts = {}) {
  const chip = document.getElementById('ghostHudChip');
  if (!chip) return;
  const identity = ghostIdentityFromModifiers(session?.modifiers);
  if (!identity || session?.gameKind !== 'ghost') {
    chip.hidden = true;
    chip.setAttribute('aria-hidden', 'true');
    const actionEl = document.getElementById('ghostHudAction');
    if (actionEl) {
      actionEl.hidden = true;
      actionEl.textContent = '';
      actionEl.classList.remove('is-flash');
    }
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

  // Same-day action reveal: only after player has locked that day (incl. hold → 观望).
  const actionEl = document.getElementById('ghostHudAction');
  const reveal = ghostRevealAfterPlayerDecisions(payload, decisionCount);
  if (actionEl) {
    if (reveal) {
      actionEl.hidden = false;
      actionEl.textContent = `第${reveal.day}日 · ${reveal.labelZh}`;
      actionEl.dataset.action = reveal.action;
      actionEl.dataset.day = String(reveal.day);
      if (opts.flashReveal) {
        actionEl.classList.remove('is-flash');
        // Force reflow so repeated reveals re-trigger the paper flash.
        void actionEl.offsetWidth;
        actionEl.classList.add('is-flash');
      }
    } else {
      actionEl.hidden = true;
      actionEl.textContent = '';
      actionEl.removeAttribute('data-action');
      actionEl.removeAttribute('data-day');
      actionEl.classList.remove('is-flash');
    }
  }
}
