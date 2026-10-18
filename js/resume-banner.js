/** 「继续对局」banner on the home / 模拟盘 landing: shown when the server still holds an active
 *  normal-mode session for the logged-in user (left via back / hash change / reload / app close).
 *  Source of truth is GET /games/active (server also expires stale sessions there) — nothing is
 *  cached across users. 继续 = same start path as the start dialog's 继续游戏 (no cost);
 *  放弃 = ctlConfirm (hand-drawn sheet, no browser dialog) then POST /games/:id/abandon (non-refundable). */
import { api, getAuthState, showToast } from './auth.js';
import { ctlConfirm } from './controls.js';
import { loadCloudGameDraft, abandonCloudGame } from './game-sync.js';
import { isResumableActive, resumeDay, resumeMetaText } from './resume-meta.js';

let current = null; // active DTO currently shown
let token = 0; // latest refresh wins
let busy = false;
let inited = false;
let debounce = 0;

const $ = (id) => document.getElementById(id);

function userId() {
  const a = getAuthState();
  return a && a.user && a.status === 'authenticated' ? a.user.id : null;
}

function gameScreenBusy() {
  const g = $('gameScreen');
  const r = $('resultScreen');
  const m = $('fillModeModal');
  return !!((g && g.classList.contains('active')) || (r && r.classList.contains('active')) || (m && !m.hidden));
}

export function hideResumeBanner() {
  token += 1; // invalidate any in-flight refresh
  current = null;
  const el = $('resumeGameBanner');
  if (el) el.hidden = true;
  setBusy(false);
}

function paint(active, dayInfo) {
  const el = $('resumeGameBanner');
  if (!el) return;
  current = active;
  $('resumeGameBannerMeta').textContent = resumeMetaText(active, dayInfo);
  setBusy(false);
  el.hidden = false;
}

function setBusy(on, label) {
  busy = on;
  const c = $('resumeGameContinueBtn');
  const a = $('resumeGameAbandonBtn');
  if (c) {
    c.disabled = on;
    c.querySelector('.resume-banner__label').textContent = on && label ? label : '继续对局';
  }
  if (a) a.disabled = on;
}

export async function refreshResumeBanner() {
  const el = $('resumeGameBanner');
  if (!el) return;
  const uid = userId();
  if (!uid || gameScreenBusy()) {
    if (!uid) hideResumeBanner();
    else if (gameScreenBusy()) { el.hidden = true; }
    return;
  }
  if (busy) return;
  const my = ++token;
  try {
    const { data } = await api('/games/active');
    if (my !== token || userId() !== uid || gameScreenBusy()) return;
    if (!isResumableActive(data)) {
      current = null;
      el.hidden = true;
      return;
    }
    let state = null;
    if ((data.protocolVersion || '') === 'event-v1') {
      try {
        state = (await api(`/games/${encodeURIComponent(data.gameId)}/state`)).data;
      } catch { state = null; }
    }
    if (my !== token || userId() !== uid || gameScreenBusy()) return;
    const draft = loadCloudGameDraft({ gameId: data.gameId, userId: uid });
    paint(data, resumeDay({
      state,
      draftActions: draft && draft.actions,
      total: data.gameDays,
    }));
  } catch {
    // Offline / server error: keep whatever is shown, never invent a banner.
  }
}

function scheduleRefresh() {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => { void refreshResumeBanner(); }, 150);
}

async function onContinue() {
  if (busy || !current) return;
  const expectId = current.gameId;
  const uid = userId();
  if (!uid) { hideResumeBanner(); return; }
  setBusy(true, '恢复中…');
  try {
    // Re-check on the server right now: it may have been finished / expired / abandoned elsewhere.
    const { data } = await api('/games/active');
    if (!isResumableActive(data) || data.gameId !== expectId) {
      showToast('这局已经结束或过期了', 'error');
      hideResumeBanner();
      void refreshResumeBanner();
      return;
    }
    const start = typeof window.__dailyStartGame === 'function' ? window.__dailyStartGame : null;
    if (!start) throw new Error('开局函数未就绪');
    const [{ ensureStocksLoaded }, { gameState }] = await Promise.all([
      import('./pack-store.js'),
      import('./state.js'),
    ]);
    const hasWindow = !!(data.window && Array.isArray(data.window.bars) && data.window.bars.length);
    if (hasWindow) ensureStocksLoaded(gameState).catch(() => {});
    else await ensureStocksLoaded(gameState);
    const draft = loadCloudGameDraft({ gameId: data.gameId, userId: uid });
    const resumeActions = draft && Array.isArray(draft.actions) ? draft.actions : null;
    await start({ cloud: data, resumeActions });
    const g = $('gameScreen');
    if (!(g && g.classList.contains('active'))) throw new Error('未能进入对局');
    hideResumeBanner();
  } catch (e) {
    showToast((e && e.message) || '恢复失败，请重试', 'error');
    setBusy(false);
  }
}

async function onAbandon() {
  if (busy || !current) return;
  const id = current.gameId;
  const daily = (current.gameKind || '') === 'daily';
  const ok = await ctlConfirm(
    '放弃后这局作废，已消耗的韭币不退还，也不会计入榜单和战绩。' + (daily ? '今日挑战的机会不会恢复。' : ''),
    { title: '放弃这局？', okLabel: '确认放弃', cancelLabel: '再想想', danger: true },
  );
  if (!ok || !current || current.gameId !== id) return;
  setBusy(true);
  try {
    await abandonCloudGame(id);
    hideResumeBanner();
    showToast('已放弃这局', 'info');
  } catch (e) {
    // 404/409: already gone or settled elsewhere → just resync the banner.
    if (e && (e.status === 404 || e.status === 409)) {
      hideResumeBanner();
      void refreshResumeBanner();
      showToast('这局已经结束了', 'info');
    } else {
      showToast((e && e.message) || '放弃失败，请重试', 'error');
      setBusy(false);
    }
  }
}

export function initResumeBanner() {
  if (inited) return;
  inited = true;
  const c = $('resumeGameContinueBtn');
  const a = $('resumeGameAbandonBtn');
  if (c) c.addEventListener('click', () => { void onContinue(); });
  if (a) a.addEventListener('click', () => { void onAbandon(); });
  const rawUid = () => { const a = getAuthState(); return (a && a.user && a.user.id) || null; };
  let lastUid = rawUid();
  document.addEventListener('stockgame:auth-changed', () => {
    const uid = rawUid();
    if (uid !== lastUid) {
      lastUid = uid;
      hideResumeBanner(); // never show another user's session
    }
    if (userId()) scheduleRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  });
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) scheduleRefresh(); });
  scheduleRefresh();
}
