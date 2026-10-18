/**
 * Lazy ES-module loader that survives one failed dynamic import.
 *
 * Chromium (and WebKit) cache a *failed* `import(url)` in the page's module map: after a blip (weak
 * network, tab backgrounded, request blocked) every later `import(sameUrl)` rejects instantly without a
 * new request, until the page is reloaded. For 保存图片 / 分享图 that meant 重试 could never succeed.
 *
 * Normal path: the caller's plain literal dynamic import — unchanged, so deploy/fingerprint-assets.mjs
 * still rewrites its specifier to the hashed file name. Only after that import rejects do we retry once with a
 * unique `?r=<timestamp>` query, which is a different URL and therefore a fresh fetch. The retry URL is
 * built by the caller from a literal `new URL(<relative path>, import.meta.url)` (which the fingerprinter
 * also rewrites), so it points at the same hashed file. A successful module is remembered, so the cache-busted
 * copy is never evaluated twice.
 */
const loaded = new Map();

/**
 * @param {string} key      stable name for the module (one entry per module)
 * @param {() => Promise<any>} literalImport  arrow wrapping the literal dynamic import (the normal path)
 * @param {() => string} urlOf               arrow returning the module's absolute URL (see above)
 */
export async function importWithRetry(key, literalImport, urlOf) {
  if (loaded.has(key)) return loaded.get(key);
  let mod;
  try {
    mod = await literalImport();
  } catch (firstErr) {
    const sep = String(urlOf()).includes('?') ? '&' : '?';
    mod = await import(/* webpackIgnore: true */ urlOf() + sep + 'r=' + Date.now());
  }
  loaded.set(key, mod);
  return mod;
}

/** Test helper. */
export function _resetLazyImportCache() {
  loaded.clear();
}
