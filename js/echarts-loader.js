/**
 * R6 — Non-blocking ECharts loader.
 *
 * Hub / start chrome must not wait on the full ECharts CDN script.
 * Chart screens call ensureEcharts() just before init; idle prefetch warms
 * the library after first paint.
 */

export const ECHARTS_VERSION = '5.4.3';

/** Primary jsDelivr, then unpkg fallback (same version pin). */
export const ECHARTS_CDN_URLS = Object.freeze([
  `https://cdn.jsdelivr.net/npm/echarts@${ECHARTS_VERSION}/dist/echarts.min.js`,
  `https://unpkg.com/echarts@${ECHARTS_VERSION}/dist/echarts.min.js`,
]);

export const ECHARTS_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

let status = ECHARTS_STATUS.IDLE;
let loadPromise = null;
let lastError = null;

/** @returns {'idle'|'loading'|'ready'|'error'} */
export function getEchartsStatus() {
  return status;
}

export function getEchartsLastError() {
  return lastError;
}

export function peekEcharts() {
  if (typeof window === 'undefined') return null;
  return window.echarts || null;
}

export function isEchartsReady() {
  return !!(peekEcharts() && status === ECHARTS_STATUS.READY);
}

/** Test-only: reset module state between cases. */
export function __resetEchartsLoaderForTests() {
  status = ECHARTS_STATUS.IDLE;
  loadPromise = null;
  lastError = null;
}

function markReadyFromGlobal() {
  const ec = peekEcharts();
  if (!ec) return null;
  status = ECHARTS_STATUS.READY;
  lastError = null;
  return ec;
}

/**
 * Pure helper: pick next CDN URL after failures (by index).
 * @param {readonly string[]} urls
 * @param {number} attemptIndex
 */
export function pickCdnUrl(urls, attemptIndex) {
  if (!Array.isArray(urls) || urls.length === 0) return null;
  if (attemptIndex < 0 || attemptIndex >= urls.length) return null;
  return urls[attemptIndex];
}

/**
 * Inject one async script tag; resolves when onload fires and window.echarts exists.
 * @param {Document} doc
 * @param {string} url
 * @param {{ createElement?: Function, append?: Function }} [hooks] test seams
 */
export function injectEchartsScript(doc, url, hooks) {
  const createElement = (hooks && hooks.createElement) || ((tag) => doc.createElement(tag));
  const append = (hooks && hooks.append) || ((el) => doc.head.appendChild(el));

  return new Promise(function (resolve, reject) {
    if (!doc || !url) {
      reject(new Error('echarts: missing document or url'));
      return;
    }
    const selector = 'script[data-echarts-loader="1"][data-echarts-src="' + cssEscapeAttr(url) + '"]';
    let s = null;
    try {
      s = doc.querySelector(selector);
    } catch (_) {
      s = null;
    }
    if (!s) {
      s = createElement('script');
      s.src = url;
      s.async = true;
      s.setAttribute('data-echarts-loader', '1');
      s.setAttribute('data-echarts-src', url);
      append(s);
    }

    const finishOk = function () {
      const ec = peekEcharts();
      if (ec) resolve(ec);
      else reject(new Error('echarts global missing after load: ' + url));
    };
    const finishErr = function () {
      reject(new Error('echarts script failed: ' + url));
    };

    if (peekEcharts()) {
      finishOk();
      return;
    }

    s.addEventListener('load', finishOk, { once: true });
    s.addEventListener('error', finishErr, { once: true });
  });
}

function cssEscapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function waitForGlobal(timeoutMs) {
  return new Promise(function (resolve) {
    if (peekEcharts()) {
      resolve(true);
      return;
    }
    const start = Date.now();
    const timer = setInterval(function () {
      if (peekEcharts()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 40);
  });
}

/**
 * Ensure window.echarts is available (async CDN load with fallbacks).
 * Concurrent callers share one in-flight promise. Failed loads allow retry.
 *
 * @param {{ timeoutMs?: number, document?: Document, urls?: string[] }} [opts]
 * @returns {Promise<any>} echarts global
 */
export function ensureEcharts(opts) {
  const options = opts || {};
  const timeoutMs = options.timeoutMs == null ? 12000 : options.timeoutMs;
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const urls = options.urls || ECHARTS_CDN_URLS;

  const existing = markReadyFromGlobal();
  if (existing) return Promise.resolve(existing);

  if (loadPromise) return loadPromise;

  if (!doc) {
    status = ECHARTS_STATUS.ERROR;
    lastError = new Error('echarts: no document');
    return Promise.reject(lastError);
  }

  status = ECHARTS_STATUS.LOADING;
  const started = Date.now();

  loadPromise = (async function () {
    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
      if (Date.now() - started >= timeoutMs) break;
      const url = pickCdnUrl(urls, i);
      if (!url) break;
      try {
        const ec = await injectEchartsScript(doc, url);
        status = ECHARTS_STATUS.READY;
        lastError = null;
        return ec;
      } catch (err) {
        lastErr = err;
      }
      const again = markReadyFromGlobal();
      if (again) return again;
    }

    const leftover = Math.max(0, timeoutMs - (Date.now() - started));
    if (leftover > 0 && (await waitForGlobal(leftover))) {
      const ec = markReadyFromGlobal();
      if (ec) return ec;
    }

    status = ECHARTS_STATUS.ERROR;
    lastError = lastErr || new Error('echarts unavailable');
    loadPromise = null;
    throw lastError;
  })();

  return loadPromise;
}

/** Fire-and-forget warm; hub/start must not await this. */
export function prefetchEcharts() {
  return ensureEcharts().catch(function (err) {
    console.warn('[echarts] prefetch failed', err);
  });
}

/**
 * Schedule idle/deferred prefetch after first paint (~0.9s like pack warm).
 * @param {number} [delayMs]
 */
export function scheduleIdleEchartsPrefetch(delayMs) {
  const delay = delayMs == null ? 900 : delayMs;
  const start = function () {
    prefetchEcharts();
  };
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') {
    window.setTimeout(function () {
      window.requestIdleCallback(start, { timeout: 2500 });
    }, delay);
  } else {
    window.setTimeout(start, delay);
  }
}

const PENDING_CLS = 'chart-pending-msg';

/** Show a lightweight loading fallback inside a chart host. */
export function markChartLoading(el, message) {
  if (!el || typeof el.setAttribute !== 'function') return;
  const text = message || '图表加载中…';
  el.setAttribute('data-chart-pending', '1');
  el.setAttribute('aria-busy', 'true');
  el.removeAttribute('data-chart-failed');
  let msg = el.querySelector && el.querySelector('.' + PENDING_CLS);
  if (!msg && typeof document !== 'undefined') {
    msg = document.createElement('div');
    msg.className = PENDING_CLS;
    el.appendChild(msg);
  }
  if (msg) msg.textContent = text;
}

export function clearChartLoading(el) {
  if (!el || typeof el.removeAttribute !== 'function') return;
  el.removeAttribute('data-chart-pending');
  el.removeAttribute('aria-busy');
  el.removeAttribute('data-chart-failed');
  const msg = el.querySelector && el.querySelector('.' + PENDING_CLS);
  if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
}

export function markChartFailed(el, message) {
  if (!el || typeof el.setAttribute !== 'function') return;
  clearChartLoading(el);
  const text = message || '图表加载失败，请检查网络后刷新';
  el.setAttribute('data-chart-failed', '1');
  if (typeof document === 'undefined') return;
  let msg = el.querySelector && el.querySelector('.' + PENDING_CLS);
  if (!msg) {
    msg = document.createElement('div');
    msg.className = PENDING_CLS;
    el.appendChild(msg);
  }
  msg.textContent = text;
}
