/** Start flow: fill-mode modal, progress, cloud create ∥ pack ensure, ACTIVE_GAME conflict.
 * Split from load-stocks.js (Architecture Phase 1).
 * attachDeferredStart still sets window.startGame as the modal wrapper (playAgain depends on it).
 */

import { getAuthState, openAuthModal, refreshMe } from './auth.js';
import {
  createCloudGame,
  fetchActiveCloudGame,
  abandonActiveCloudGame,
  loadCloudGameDraft,
  clearCloudGameDraft,
} from './game-sync.js';
import {
  ensureStocksLoaded,
  prefetchStocksPack,
  packReady,
  scheduleDeferredPrefetch,
} from './pack-store.js';

function perfEnabled() {
  try {
    return localStorage.getItem('STOCKGAME_PERF') === '1';
  } catch {
    return false;
  }
}

function perfLog(label, ms, extra) {
  if (!perfEnabled()) return;
  const bit = extra ? ' ' + JSON.stringify(extra) : '';
  console.log('[perf]', label, Math.round(ms) + 'ms' + bit);
}

export function attachDeferredStart(startGame, gameState) {
  let locked = false;

  function modalEl() {
    return document.getElementById('fillModeModal');
  }

  function choosePane() {
    return document.getElementById('fillModeChoosePane');
  }

  function loadingPane() {
    return document.getElementById('fillModeLoadingPane');
  }

  function titleEl() {
    return document.getElementById('fillModeDialogTitle');
  }

  function conflictPane() {
    return document.getElementById('fillModeConflictPane');
  }

  function setProgress(pct, tip) {
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

  function showChooseView() {
    const choose = choosePane();
    const loading = loadingPane();
    const conflict = conflictPane();
    const title = titleEl();
    if (choose) choose.hidden = false;
    if (loading) loading.hidden = true;
    if (conflict) conflict.hidden = true;
    if (title) title.textContent = '选择成交方式';
    setProgress(0, '股票资源加载中…');
    const modal = modalEl();
    if (modal) modal.classList.remove('is-loading');
  }

  function showLoadingView() {
    const choose = choosePane();
    const loading = loadingPane();
    const conflict = conflictPane();
    const title = titleEl();
    if (choose) choose.hidden = true;
    if (conflict) conflict.hidden = true;
    if (loading) loading.hidden = false;
    if (title) title.textContent = '正在开局';
    const modal = modalEl();
    if (modal) modal.classList.add('is-loading');
    setProgress(4, '准备中…');
  }

  function showConflictView(meta) {
    const choose = choosePane();
    const loading = loadingPane();
    const conflict = conflictPane();
    const title = titleEl();
    if (choose) choose.hidden = true;
    if (loading) loading.hidden = true;
    if (conflict) conflict.hidden = false;
    if (title) title.textContent = '已有云端对局';
    const modal = modalEl();
    if (modal) modal.classList.remove('is-loading');
    const detail = document.getElementById('fillModeConflictDetail');
    if (detail) {
      const fillLabel = meta && meta.fillMode === 'same_close' ? '当日收盘成交' : '次日开盘成交';
      const stockBit = meta && (meta.stockName || meta.stockCode)
        ? (' · ' + (meta.stockName || '') + (meta.stockCode ? '（' + meta.stockCode + '）' : ''))
        : '';
      const draftBit = meta && meta.draftDay
        ? ('本机进度：已决策 ' + meta.decided + ' 日，将从第 ' + meta.draftDay + ' 日继续')
        : '本机暂无未提交进度（将从第 1 日继续同一云端题目）';
      detail.textContent = fillLabel + stockBit + '。' + draftBit + '。跨设备不保证同步未提交动作。';
    }
  }

  let conflictResolver = null;

  function askActiveGameConflict(meta) {
    return new Promise(function (resolve) {
      conflictResolver = resolve;
      showConflictView(meta || {});
    });
  }

  function resolveConflict(choice) {
    if (!conflictResolver) return;
    const r = conflictResolver;
    conflictResolver = null;
    r(choice);
  }

  function openModal() {
    const modal = modalEl();
    if (!modal) return;
    showChooseView();
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    prefetchStocksPack(gameState);
    const first = modal.querySelector('input[name="fillMode"]:checked');
    if (first) first.focus();
  }

  function closeModal() {
    const modal = modalEl();
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    showChooseView();
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function animateTo(targetPct, tip, ms) {
    return new Promise(function (resolve) {
      const fill = document.getElementById('fillLoadFill');
      const startPct = fill ? (parseFloat(fill.style.width) || 0) : 0;
      const from = Number.isFinite(startPct) ? startPct : 0;
      const to = Math.max(from, targetPct);
      const t0 = performance.now();
      const dur = Math.max(0, ms);
      if (dur <= 0) {
        setProgress(to, tip);
        resolve();
        return;
      }
      function frame(now) {
        const t = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - t, 2);
        setProgress(from + (to - from) * eased, tip);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  window.startGame = function () {
    if (locked) return;
    const auth = getAuthState();
    if (!auth.user) {
      openAuthModal('login');
      return;
    }
    openModal();
  };

  window.cancelFillModeModal = function () {
    if (conflictResolver) {
      resolveConflict('cancel');
      closeModal();
      locked = false;
      return;
    }
    if (locked) return;
    closeModal();
  };

  window.continueActiveCloudGame = function () {
    resolveConflict('continue');
  };

  window.restartActiveCloudGame = function () {
    resolveConflict('restart');
  };

  window.confirmFillModeAndStart = function () {
    if (locked) return;
    locked = true;
    showLoadingView();

    const run = async function () {
      const tAll = performance.now();
      const fillInput = document.querySelector('input[name="fillMode"]:checked');
      const fillMode = fillInput && fillInput.value === 'same_close' ? 'same_close' : 'next_open';
      const auth = getAuthState();
      // Locked economy: cloud CREATE only; no silent local full-game substitute when logged out.
      if (!auth.user) {
        openAuthModal('login');
        const cancelErr = new Error('请先登录');
        cancelErr.code = 'USER_CANCELLED';
        throw cancelErr;
      }
      const wantCloud = true;

      const packAlreadyReady = packReady();
      setProgress(packAlreadyReady ? 55 : 8, packAlreadyReady ? '资源已就绪…' : '股票资源加载中…');

      let cloudPromise = null;
      if (wantCloud) {
        setProgress(packAlreadyReady ? 62 : 12, '创建云端对局…');
        cloudPromise = createCloudGame(fillMode).then(function (cloud) {
          clearCloudGameDraft();
          return cloud;
        });
      }

      const packPromiseEnsure = ensureStocksLoaded(gameState, function (ratio) {
        const top = wantCloud ? 70 : 88;
        setProgress(8 + Math.max(0, Math.min(1, ratio)) * (top - 8), '股票资源加载中…');
      });

      await packPromiseEnsure;
      if (packAlreadyReady) {
        await animateTo(wantCloud ? 70 : 90, wantCloud ? '创建云端对局…' : '初始化模拟盘…', 120);
      } else {
        await animateTo(wantCloud ? 72 : 90, wantCloud ? '创建云端对局…' : '初始化模拟盘…', 80);
      }

      let cloud = null;
      let resumeActions = null;
      if (wantCloud) {
        try {
          cloud = await cloudPromise;
        } catch (e) {
          if (e && e.code === 'ACTIVE_GAME_EXISTS') {
            let active = e.details && e.details.game ? e.details.game : null;
            if (!active || !active.gameId) {
              active = await fetchActiveCloudGame();
            }
            if (!active || !active.gameId) throw e;

            const draft = loadCloudGameDraft({
              gameId: active.gameId,
              userId: auth.user && auth.user.id,
            });
            const decided = draft && draft.actions ? draft.actions.length : 0;
            const choice = await askActiveGameConflict({
              fillMode: active.fillMode,
              stockName: active.stockName,
              stockCode: active.stockCode,
              decided: decided,
              draftDay: decided ? decided + 1 : 0,
            });

            if (choice === 'cancel') {
              const cancelErr = new Error('已取消');
              cancelErr.code = 'USER_CANCELLED';
              throw cancelErr;
            }

            if (choice === 'continue') {
              cloud = active;
              resumeActions = draft && draft.actions ? draft.actions : [];
              showLoadingView();
              await animateTo(90, '恢复云端对局…', 120);
            } else {
              showLoadingView();
              setProgress(82, '放弃旧局…');
              await abandonActiveCloudGame();
              clearCloudGameDraft(active.gameId);
              cloud = await createCloudGame(fillMode);
              resumeActions = null;
            }
          } else {
            throw e;
          }
        }
      }

      setProgress(94, '进入模拟盘…');
      if (cloud) {
        try {
          await refreshMe();
        } catch { /* ignore */ }
        await startGame({ cloud: cloud, resumeActions: resumeActions });
      } else {
        // Should not reach: guest/local path removed.
        throw new Error('需要登录后创建云端对局');
      }

      const game = document.getElementById('gameScreen');
      if (!(game && game.classList.contains('active'))) {
        throw new Error('game screen inactive');
      }
      setProgress(100, '即将进入…');
      await delay(60);
      closeModal();
      perfLog('start.total', performance.now() - tAll, {
        packReady: packAlreadyReady,
        cloud: !!cloud,
      });
    };

    run()
      .catch(function (err) {
        if (err && err.code === 'USER_CANCELLED') {
          showChooseView();
          return;
        }
        console.error(err);
        showChooseView();
        const msg = (err && err.message) ? err.message : '股票数据加载失败，请刷新后重试';
        window.alert(msg);
      })
      .finally(function () {
        locked = false;
      });
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const modal = modalEl();
    if (modal && !modal.hidden) window.cancelFillModeModal();
  });

  scheduleDeferredPrefetch(gameState);
  window.__stockgamePrefetchPack = function () {
    prefetchStocksPack(gameState);
  };
}

