/**
 * Stale-deploy guard for lazy chunks. After a deploy, fingerprinted chunk names
 * change; a tab/WebView opened before it still imports the old URLs (404 →
 * "Failed to fetch dynamically imported module"). Reload once to pick up the
 * new index.html; if that already happened this session, surface a clear message.
 */
const KEY = "sg:chunk-reload-at";
const CHUNK_ERR = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|module script/i;

export function isChunkLoadError(err) {
  return !!err && (err.name === "ChunkLoadError" || CHUNK_ERR.test(String(err.message || err)));
}

export async function loadChunk(loader) {
  try {
    return await loader();
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      location.reload();
      return new Promise(() => {}); // page is going away
    }
    const e = new Error("页面已更新，请刷新后重试");
    e.cause = err;
    throw e;
  }
}
