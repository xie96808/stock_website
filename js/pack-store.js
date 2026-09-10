/** Pack store: fetch / IDB / worker / ensure / prefetch only.
 * Split from load-stocks.js (Architecture Phase 1). No start-flow / modal UI here.
 *
 * Phase 4 residual: prefer versioned `data/stocks_data.<datasetSha>.json`
 * (sha === server datasetVersion). Unversioned JSON/JS remain fallbacks.
 */

import {
  PACK_META_URL,
  PACK_FALLBACK_URL,
  PACK_JS_FALLBACK_URL,
  LEGACY_IDB_KEY,
  normalizePackMeta,
  idbKeyForPack,
  versionedPackUrl,
} from './pack-url.js';

const IDB_NAME = 'stockgame-pack';
const IDB_VER = 1;
const STORE = 'packs';

/** Last resolved dataset sha (pack-meta or legacy null). */
let loadedDatasetSha = null;

export function getLoadedDatasetSha() {
  return loadedDatasetSha;
}

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

let packPromise = null;

export function packReady() {
  return Array.isArray(window.STOCKS_DATA) && window.STOCKS_DATA.length > 0;
}

function ready() {
  return packReady();
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

function headPackMeta(url) {
  const t0 = performance.now();
  return fetch(url, { method: 'HEAD', cache: 'no-cache' })
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

function parsePackText(text, meta, cacheKey) {
  const t0 = performance.now();
  const key = cacheKey || LEGACY_IDB_KEY;
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
        cacheKey: key,
        meta: meta || {},
      });
    });
  }
  const pack = parseOnMain(text);
  perfLog('pack.parse.main', performance.now() - t0, { stocks: pack && pack.length });
  idbPut({ key: key, text: text, meta: meta || {}, savedAt: Date.now() }).catch(function () {});
  return Promise.resolve(pack);
}

function fetchPackText(url, onProgress, fallbackUrl) {
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
        perfLog('pack.fetch', performance.now() - fetchStart, { bytes: text.length, via: 'text', url: url });
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
          perfLog('pack.fetch', performance.now() - fetchStart, { bytes: text.length, via: 'stream', url: url });
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

  return fetch(url)
    .then(fromResponse)
    .catch(function (err) {
      if (!fallbackUrl || fallbackUrl === url) throw err;
      console.warn('pack fetch failed, trying fallback', url, err);
      return fetch(fallbackUrl).then(fromResponse);
    });
}

function fetchPackMetaDoc() {
  const t0 = performance.now();
  return fetch(PACK_META_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (raw) {
      const meta = normalizePackMeta(raw);
      perfLog('pack.meta', performance.now() - t0, meta ? { sha: meta.datasetSha.slice(0, 12) } : { miss: true });
      return meta;
    })
    .catch(function () {
      return null;
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
      const packMeta = await fetchPackMetaDoc();
      const datasetSha = packMeta ? packMeta.datasetSha : null;
      const cacheKey = idbKeyForPack(datasetSha);
      const primaryUrl = packMeta
        ? packMeta.packUrl
        : PACK_FALLBACK_URL;
      const fallbackUrl = packMeta
        ? packMeta.fallbackUrl
        : PACK_JS_FALLBACK_URL;
      // When versioned: secondary fallback is unversioned json then js handled below.
      const secondaryFallback = packMeta ? PACK_JS_FALLBACK_URL : null;

      try {
        const cached = await idbGet(cacheKey);
        if (cached && cached.text) {
          if (datasetSha) {
            // Versioned: sha key is authoritative — skip HEAD.
            if (onProgress) onProgress(0.5);
            const pack = await parsePackText(cached.text, cached.meta || {}, cacheKey);
            if (!Array.isArray(pack) || pack.length === 0) throw new Error('empty cached pack');
            window.STOCKS_DATA = pack;
            loadedDatasetSha = datasetSha;
            if (typeof window !== 'undefined') window.STOCKS_DATASET_SHA = datasetSha;
            if (onProgress) onProgress(1);
            perfLog('pack.cache.hit', 0, { stocks: pack.length, key: cacheKey.slice(0, 12) });
            return pack;
          }
          // Legacy unversioned: validate with HEAD etag / length.
          const headMeta = await headPackMeta(primaryUrl);
          if (cacheMetaMatches(cached, headMeta || cached.meta || {})) {
            if (onProgress) onProgress(0.5);
            const pack = await parsePackText(cached.text, cached.meta || headMeta || {}, cacheKey);
            if (!Array.isArray(pack) || pack.length === 0) throw new Error('empty cached pack');
            window.STOCKS_DATA = pack;
            loadedDatasetSha = null;
            if (onProgress) onProgress(1);
            perfLog('pack.cache.hit', 0, { stocks: pack.length, key: LEGACY_IDB_KEY });
            return pack;
          }
        }
      } catch (cacheErr) {
        if (perfEnabled()) console.warn('[perf] pack.cache', cacheErr);
      }

      let fetched;
      try {
        fetched = await fetchPackText(primaryUrl, onProgress, fallbackUrl);
      } catch (err) {
        if (secondaryFallback) {
          fetched = await fetchPackText(fallbackUrl, onProgress, secondaryFallback);
        } else {
          throw err;
        }
      }
      const pack = await parsePackText(fetched.text, fetched.meta || {}, cacheKey);
      // Persist for IDB when worker path did not (worker keeps its own); always put here for sha key.
      idbPut({
        key: cacheKey,
        text: fetched.text,
        meta: fetched.meta || {},
        savedAt: Date.now(),
        datasetSha: datasetSha || null,
      }).catch(function () {});
      fetched.text = null;
      if (!Array.isArray(pack) || pack.length === 0) {
        throw new Error('empty pack');
      }
      window.STOCKS_DATA = pack;
      loadedDatasetSha = datasetSha;
      if (typeof window !== 'undefined' && datasetSha) {
        window.STOCKS_DATASET_SHA = datasetSha;
      }
      if (onProgress) onProgress(1);
      return pack;
    })
    .catch(function (err) {
      packPromise = null;
      throw err;
    });

  return packPromise;
}

export function scheduleDeferredPrefetch(gameState) {
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

// Re-export helpers for tests / advanced callers
export {
  versionedPackUrl,
  idbKeyForPack,
  normalizePackMeta,
  PACK_META_URL,
  PACK_FALLBACK_URL,
};
