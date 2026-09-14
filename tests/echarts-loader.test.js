import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ECHARTS_CDN_URLS,
  ECHARTS_STATUS,
  ECHARTS_VERSION,
  pickCdnUrl,
  getEchartsStatus,
  ensureEcharts,
  injectEchartsScript,
  markChartLoading,
  clearChartLoading,
  markChartFailed,
  __resetEchartsLoaderForTests,
} from '../js/echarts-loader.js';

test('CDN pin and fallbacks', () => {
  assert.equal(ECHARTS_VERSION, '5.4.3');
  assert.equal(ECHARTS_CDN_URLS.length, 2);
  assert.match(ECHARTS_CDN_URLS[0], /jsdelivr/);
  assert.match(ECHARTS_CDN_URLS[1], /unpkg/);
  assert.equal(pickCdnUrl(ECHARTS_CDN_URLS, 0), ECHARTS_CDN_URLS[0]);
  assert.equal(pickCdnUrl(ECHARTS_CDN_URLS, 1), ECHARTS_CDN_URLS[1]);
  assert.equal(pickCdnUrl(ECHARTS_CDN_URLS, 2), null);
  assert.equal(pickCdnUrl([], 0), null);
});

test('ensureEcharts reuses window.echarts without injecting', async () => {
  __resetEchartsLoaderForTests();
  const fake = { init() { return {}; } };
  globalThis.window = { echarts: fake };
  const created = [];
  const doc = {
    createElement() { throw new Error('should not inject'); },
    head: { appendChild() { throw new Error('should not append'); } },
    querySelector() { return null; },
  };
  const ec = await ensureEcharts({ document: doc, timeoutMs: 500 });
  assert.equal(ec, fake);
  assert.equal(getEchartsStatus(), ECHARTS_STATUS.READY);
  assert.equal(created.length, 0);
  delete globalThis.window;
  __resetEchartsLoaderForTests();
});

test('injectEchartsScript sets async + data attrs and resolves on load', async () => {
  __resetEchartsLoaderForTests();
  const fake = { init() { return {}; } };
  globalThis.window = {};
  let appended = null;
  const listeners = {};
  const el = {
    src: '',
    async: false,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  const doc = {
    head: {},
    querySelector() { return null; },
    createElement() { return el; },
  };
  const p = injectEchartsScript(doc, ECHARTS_CDN_URLS[0], {
    createElement: () => el,
    append: (node) => { appended = node; },
  });
  assert.equal(el.async, true);
  assert.equal(el.attrs['data-echarts-loader'], '1');
  assert.equal(el.src, ECHARTS_CDN_URLS[0]);
  assert.equal(appended, el);
  globalThis.window.echarts = fake;
  listeners.load();
  const ec = await p;
  assert.equal(ec, fake);
  delete globalThis.window;
  __resetEchartsLoaderForTests();
});

test('ensureEcharts tries next CDN after first failure', async () => {
  __resetEchartsLoaderForTests();
  globalThis.window = {};
  const urls = ['https://fail.example/a.js', 'https://ok.example/b.js'];
  const fake = { ok: true };
  let attempt = 0;
  const docs = {
    head: {},
    querySelector() { return null; },
  };
  // Monkey via inject by stubbing createElement path through ensure → injectEchartsScript
  // We pass a custom document and intercept by replacing inject via URL load simulation:
  // Build fake scripts that error then succeed.
  const scripts = [];
  const createElement = () => {
    const listeners = {};
    const el = {
      src: '',
      async: false,
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { listeners[type] = fn; this._listeners = listeners; },
      _listeners: listeners,
    };
    scripts.push(el);
    return el;
  };
  const append = (el) => {
    attempt += 1;
    queueMicrotask(() => {
      if (el.src.includes('fail')) {
        el._listeners.error();
      } else {
        globalThis.window.echarts = fake;
        el._listeners.load();
      }
    });
  };
  // Patch Document methods used inside injectEchartsScript when hooks not passed —
  // ensureEcharts calls injectEchartsScript(doc, url) without hooks, so doc.createElement/head.appendChild matter.
  docs.createElement = createElement;
  docs.head.appendChild = append;

  const ec = await ensureEcharts({ document: docs, urls, timeoutMs: 2000 });
  assert.equal(ec, fake);
  assert.equal(attempt, 2);
  assert.equal(getEchartsStatus(), ECHARTS_STATUS.READY);
  delete globalThis.window;
  __resetEchartsLoaderForTests();
});

test('markChartLoading / clear / failed DOM helpers', () => {
  const kids = [];
  const el = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector(sel) {
      if (sel === '.chart-pending-msg') return kids.find((c) => c.className === 'chart-pending-msg') || null;
      return null;
    },
    appendChild(node) { kids.push(node); return node; },
  };
  // Minimal document for createElement inside helpers
  globalThis.document = {
    createElement(tag) {
      const node = {
        tagName: tag,
        className: '',
        textContent: '',
        parentNode: null,
      };
      node.parentNode = { removeChild(n) {
        const i = kids.indexOf(n);
        if (i >= 0) kids.splice(i, 1);
      } };
      // when appended, wire parent
      const origAppend = el.appendChild.bind(el);
      el.appendChild = (n) => {
        n.parentNode = { removeChild(x) {
          const i = kids.indexOf(x);
          if (i >= 0) kids.splice(i, 1);
        } };
        return origAppend(n);
      };
      return node;
    },
  };

  markChartLoading(el, '加载中');
  assert.equal(el.attrs['data-chart-pending'], '1');
  assert.equal(el.attrs['aria-busy'], 'true');
  assert.equal(kids.length, 1);
  assert.equal(kids[0].textContent, '加载中');

  clearChartLoading(el);
  assert.equal(el.attrs['data-chart-pending'], undefined);
  assert.equal(kids.length, 0);

  markChartFailed(el, '失败');
  assert.equal(el.attrs['data-chart-failed'], '1');
  assert.equal(kids[0].textContent, '失败');

  delete globalThis.document;
});
