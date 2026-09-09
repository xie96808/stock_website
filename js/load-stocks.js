import { getAuthState } from './auth.js';
import {
  createCloudGame,
  fetchActiveCloudGame,
  abandonActiveCloudGame,
  loadCloudGameDraft,
  clearCloudGameDraft,
} from './game-sync.js';

/** Pack URL: JSON.parse is faster than JS Function eval; nginx already gzips (~12MB). */
const PACK_URL = 'data/stocks_data.json';
const PACK_JS_FALLBACK = 'data/stocks_data.js';
const IDB_NAME = 'stockgame-pack';
const IDB_VER = 1;
const STORE = 'packs';
const CACHE_KEY = 'stocks-pack-v1';

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

function openDb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no idb'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('idb open failed')); };
  });
}

function idbGet(key) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('idb get failed')); };
    });
  });
}

function idbPut(record) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('idb put failed')); };
      tx.objectStore(STORE).put(record);
    });
  });
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
      const playInput = document.querySelector('input[name="playMode"]:checked');
      const playMode = playInput ? playInput.value : 'auto';
      const auth = getAuthState();
      const wantCloud = auth.user && playMode !== 'local';

      const packAlreadyReady = ready();
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
        await startGame({ cloud: cloud, resumeActions: resumeActions });
      } else {
        await startGame({ practiceOnly: true });
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

function cacheMetaMatches(entry, meta) {
  if (!entry || !entry.text) return false;
  if (!meta) return true;
  if (meta.etag && entry.meta && entry.meta.etag) {
    return entry.meta.etag === meta.etag;
  }
  if (meta.lastModified && entry.meta && entry.meta.lastModified) {
    return entry.meta.lastModified === meta.lastModified;
  }
  if (meta.contentLength && entry.meta && entry.meta.contentLength) {
    return String(entry.meta.contentLength) === String(meta.contentLength);
  }
  return true;
}

function headPackMeta() {
  const t0 = performance.now();
  return fetch(PACK_URL, { method: 'HEAD', cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) return null;
      const meta = {
        etag: res.headers.get('etag') || '',
        lastModified: res.headers.get('last-modified') || '',
        contentLength: res.headers.get('content-length') || '',
      };
      perfLog('pack.head', performance.now() - t0, meta);
      return meta;
    })
    .catch(function () { return null; });
}

function parseOnMain(text) {
  const trimmed = String(text).replace(/^\uFEFF/, '').trim();
  if (trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{') {
    return JSON.parse(trimmed);
  }
  return new Function(trimmed + '\nreturn STOCKS_DATA;')();
}

function parsePackText(text, meta) {
  const t0 = performance.now();
  if (typeof Worker !== 'undefined') {
    return new Promise(function (resolve, reject) {
      let settled = false;
      let worker;
      try {
        worker = new Worker(new URL('./stocks-pack-worker.js', import.meta.url));
      } catch (err) {
        try {
          const pack = parseOnMain(text);
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
        perfLog('pack.parse.worker', performance.now() - t0, {
          stocks: msg.pack.length,
          cached: !!msg.cached,
        });
        resolve(msg.pack);
      };
      worker.onerror = function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (_) { /* ignore */ }
        try {
          const pack = parseOnMain(text);
          perfLog('pack.parse.main_fallback', performance.now() - t0, { stocks: pack && pack.length });
          resolve(pack);
        } catch (e2) {
          reject(err.error || e2 || err);
        }
      };
      worker.postMessage({
        mode: 'parseAndKeep',
        text: text,
        cacheKey: CACHE_KEY,
        meta: meta || {},
      });
    });
  }
  const pack = parseOnMain(text);
  perfLog('pack.parse.main', performance.now() - t0, { stocks: pack && pack.length });
  idbPut({ key: CACHE_KEY, text: text, meta: meta || {}, savedAt: Date.now() }).catch(function () {});
  return Promise.resolve(pack);
}

function fetchPackText(onProgress) {
  const fetchStart = performance.now();
  function fromResponse(res) {
    if (!res.ok) throw new Error('http ' + res.status);
    const meta = {
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
      contentLength: res.headers.get('content-length') || '',
    };
    const total = Number(meta.contentLength) || 0;
    if (!res.body || !total || !res.body.getReader) {
      return res.text().then(function (text) {
        if (onProgress) onProgress(0.85);
        perfLog('pack.fetch', performance.now() - fetchStart, { bytes: text.length, via: 'text' });
        return { text: text, meta: meta };
      });
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (onProgress) onProgress(0.85);
          const text = decodeChunks(chunks);
          perfLog('pack.fetch', performance.now() - fetchStart, { bytes: text.length, via: 'stream' });
          return { text: text, meta: meta };
        }
        chunks.push(result.value);
        received += result.value.length;
        if (onProgress) onProgress(Math.min(0.85, (received / total) * 0.85));
        return pump();
      });
    }
    return pump();
  }

  return fetch(PACK_URL)
    .then(fromResponse)
    .catch(function (err) {
      console.warn('stocks_data.json fetch failed, trying .js', err);
      return fetch(PACK_JS_FALLBACK).then(fromResponse);
    });
}

function loadPack(onProgress) {
  if (ready()) {
    if (onProgress) onProgress(1);
    return Promise.resolve();
  }
  if (packPromise) {
    return packPromise.then(function () {
      if (onProgress) onProgress(1);
    });
  }

  packPromise = Promise.resolve()
    .then(async function () {
      try {
        const cached = await idbGet(CACHE_KEY);
        if (cached && cached.text) {
          // Only pay for HEAD when we might skip the network.
          const meta = await headPackMeta();
          if (cacheMetaMatches(cached, meta || cached.meta || {})) {
            if (onProgress) onProgress(0.5);
            const pack = await parsePackText(cached.text, cached.meta || meta || {});
            if (!Array.isArray(pack) || pack.length === 0) throw new Error('empty cached pack');
            window.STOCKS_DATA = pack;
            if (onProgress) onProgress(1);
            perfLog('pack.cache.hit', 0, { stocks: pack.length });
            return pack;
          }
        }
      } catch (cacheErr) {
        if (perfEnabled()) console.warn('[perf] pack.cache', cacheErr);
      }

      const fetched = await fetchPackText(onProgress);
      const pack = await parsePackText(fetched.text, fetched.meta || {});
      fetched.text = null;
      if (!Array.isArray(pack) || pack.length === 0) {
        throw new Error('empty pack');
      }
      window.STOCKS_DATA = pack;
      if (onProgress) onProgress(1);
      return pack;
    })
    .catch(function (err) {
      packPromise = null;
      throw err;
    });

  return packPromise;
}

function scheduleDeferredPrefetch(gameState) {
  const start = function () {
    prefetchStocksPack(gameState);
  };
  const delayMs = 900;
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.setTimeout(function () {
      window.requestIdleCallback(start, { timeout: 2500 });
    }, delayMs);
  } else {
    window.setTimeout(start, delayMs);
  }
}

/** Fire-and-forget warm: home idle / 模拟盘 hub / fill-mode modal. */
export function prefetchStocksPack(gameState) {
  return ensureStocksLoaded(gameState).catch(function (err) {
    console.error(err);
  });
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
