import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
let reloads = 0;
globalThis.location = { reload: () => { reloads++; } };
const { loadChunk, isChunkLoadError } = await import("../js/chunk-reload.js");
const chunkErr = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://x/js/pvp/room.a5e70c290c.js"));

test("passes through a successful import", async () => {
  assert.deepEqual(await loadChunk(async () => ({ ok: 1 })), { ok: 1 });
});
test("non-chunk errors are rethrown untouched", async () => {
  await assert.rejects(loadChunk(() => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(reloads, 0);
});
test("stale chunk reloads once, then surfaces a refresh message", async () => {
  const p = loadChunk(chunkErr);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(reloads, 1);
  let settled = false; p.then(() => (settled = true), () => (settled = true));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(settled, false, "pending while the page reloads");
  await assert.rejects(loadChunk(chunkErr), /页面已更新/);
  assert.equal(reloads, 1, "no reload loop");
});
test("detects Safari/Firefox wording", () => {
  assert.ok(isChunkLoadError(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkLoadError(new TypeError("error loading dynamically imported module")));
});
