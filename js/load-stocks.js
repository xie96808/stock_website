import { getAuthState } from './auth.js';
import {
  createCloudGame,
  fetchActiveCloudGame,
  abandonActiveCloudGame,
  loadCloudGameDraft,
  clearCloudGameDraft,
} from './game-sync.js';

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

  function conflictPane() {
    return document.getElementById('fillModeConflictPane');
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
    setProgress(4, '股票资源加载中…');
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
    // Warm pack while user picks a mode (no progress UI yet).
    ensureStocksLoaded(gameState).catch(function (err) {
      console.error(err);
    });
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
      function frame(now) {
        const t = Math.min(1, (now - t0) / Math.max(1, ms));
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
      setProgress(6, '股票资源加载中…');
      if (ready()) {
        await animateTo(62, '股票资源加载中…', 480);
      } else {
        await ensureStocksLoaded(gameState, function (ratio) {
          setProgress(6 + Math.max(0, Math.min(1, ratio)) * 56, '股票资源加载中…');
        });
        await animateTo(66, '股票资源加载中…', 160);
      }

      const fillInput = document.querySelector('input[name="fillMode"]:checked');
      const fillMode = fillInput && fillInput.value === 'same_close' ? 'same_close' : 'next_open';
      const playInput = document.querySelector('input[name="playMode"]:checked');
      const playMode = playInput ? playInput.value : 'auto';
      const auth = getAuthState();
      const wantCloud = auth.user && playMode !== 'local';

      let cloud = null;
      let resumeActions = null;
      if (wantCloud) {
        await animateTo(78, '创建云端对局…', 320);
        try {
          cloud = await createCloudGame(fillMode);
          clearCloudGameDraft(); // new seed → drop any stale draft
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
              await animateTo(90, '恢复云端对局…', 280);
            } else {
              // restart: abandon old session and create a fresh one
              showLoadingView();
              await animateTo(82, '放弃旧局…', 200);
              await abandonActiveCloudGame();
              clearCloudGameDraft(active.gameId);
              cloud = await createCloudGame(fillMode);
              resumeActions = null;
            }
          } else {
            throw e;
          }
        }
      } else {
        await animateTo(80, '标的筛选中…', 560);
        await animateTo(88, '标的筛选中…', 240);
      }

      await animateTo(94, '初始化模拟盘…', 280);
      if (cloud) {
        await startGame({ cloud: cloud, resumeActions: resumeActions });
      } else {
        await startGame({ practiceOnly: true });
      }

      const game = document.getElementById('gameScreen');
      if (!(game && game.classList.contains('active'))) {
        throw new Error('game screen inactive');
      }
      setProgress(100, '即将进入…');
      await delay(220);
      closeModal();
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

  // Defer pack prefetch until after first paint + idle so login/register/avatar
  // clicks are not competing with a ~55MB download + ~1s parse on the main thread.
  scheduleDeferredPrefetch(gameState);
}

let packPromise = null;

function ready() {
  return Array.isArray(window.STOCKS_DATA) && window.STOCKS_DATA.length > 0;
}

function apply(gameState) {
  if (!gameState) return;
  gameState.stocksData = window.STOCKS_DATA;
}

function decodeChunks(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return new TextDecoder('utf-8').decode(merged);
}

function parsePackText(text) {
  const t0 = performance.now();
  if (typeof Worker !== 'undefined') {
    return new Promise(function (resolve, reject) {
      let settled = false;
      let worker;
      try {
        worker = new Worker(new URL('./stocks-pack-worker.js', import.meta.url));
      } catch (err) {
        try {
          const pack = new Function(text + '\nreturn STOCKS_DATA;')();
          perfLog('pack.parse.main', performance.now() - t0, { stocks: pack && pack.length });
          resolve(pack);
        } catch (e2) {
          reject(e2);
        }
        return;
      }
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch (_) { /* ignore */ }
        reject(new Error('pack worker timeout'));
      }, 60000);
      worker.onmessage = function (ev) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (_) { /* ignore */ }
        const msg = ev.data || {};
        if (!msg.ok) {
          reject(new Error(msg.error || 'pack parse failed'));
          return;
        }
        perfLog('pack.parse.worker', performance.now() - t0, { stocks: msg.pack.length });
        resolve(msg.pack);
      };
      worker.onerror = function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (_) { /* ignore */ }
        // Fallback: parse on main thread if worker fails to load.
        try {
          const pack = new Function(text + '\nreturn STOCKS_DATA;')();
          perfLog('pack.parse.main_fallback', performance.now() - t0, { stocks: pack && pack.length });
          resolve(pack);
        } catch (e2) {
          reject(err.error || e2 || err);
        }
      };
      worker.postMessage({ text: text });
    });
  }
  const pack = new Function(text + '\nreturn STOCKS_DATA;')();
  perfLog('pack.parse.main', performance.now() - t0, { stocks: pack && pack.length });
  return Promise.resolve(pack);
}

function loadPack(onProgress) {
  if (ready()) {
    if (onProgress) onProgress(1);
    return Promise.resolve();
  }
  if (packPromise) {
    // Another caller already fetching — still emit progress when done.
    return packPromise.then(function () {
      if (onProgress) onProgress(1);
    });
  }

  const fetchStart = performance.now();
  packPromise = fetch('data/stocks_data.js')
    .then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body || !total || !res.body.getReader) {
        return res.text().then(function (text) {
          if (onProgress) onProgress(0.85);
          return text;
        });
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (onProgress) onProgress(0.85);
            return decodeChunks(chunks);
          }
          chunks.push(result.value);
          received += result.value.length;
          // Reserve last 15% of progress bar for off-main-thread parse.
          if (onProgress) onProgress(Math.min(0.85, (received / total) * 0.85));
          return pump();
        });
      }
      return pump();
    })
    .then(function (text) {
      perfLog('pack.fetch', performance.now() - fetchStart, { bytes: text.length });
      return parsePackText(text).then(function (pack) {
        // Drop giant source string ASAP for GC.
        text = null;
        if (!Array.isArray(pack) || pack.length === 0) {
          throw new Error('empty pack');
        }
        window.STOCKS_DATA = pack;
        if (onProgress) onProgress(1);
        return pack;
      });
    })
    .catch(function (err) {
      packPromise = null;
      throw err;
    });

  return packPromise;
}

function scheduleDeferredPrefetch(gameState) {
  const start = function () {
    ensureStocksLoaded(gameState).catch(function (err) {
      console.error(err);
    });
  };
  const delayMs = 2500;
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.setTimeout(function () {
      window.requestIdleCallback(start, { timeout: 4000 });
    }, delayMs);
  } else {
    window.setTimeout(start, delayMs);
  }
}

export function ensureStocksLoaded(gameState, onProgress) {
  return loadPack(onProgress).then(function () {
    apply(gameState);
    if (gameState && Array.isArray(gameState.stocksData)) {
      console.log('Loaded ' + gameState.stocksData.length + ' stocks');
    }
    if (onProgress) onProgress(1);
  });
}
