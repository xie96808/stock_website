import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDraftActions,
  saveCloudGameDraft,
  loadCloudGameDraft,
  clearCloudGameDraft,
  CLOUD_DRAFT_KEY,
} from "../js/cloud-draft.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

test("normalizeDraftActions clips and validates", () => {
  assert.deepEqual(normalizeDraftActions(["buy", "hold", "nope"]), ["buy", "hold"]);
  assert.deepEqual(normalizeDraftActions([{ action: "sell" }, "hold"]), ["sell", "hold"]);
  assert.equal(normalizeDraftActions(new Array(40).fill("hold")).length, 29);
});

test("save/load/clear cloud draft round-trip", () => {
  store.clear();
  assert.equal(
    saveCloudGameDraft({
      gameId: "g1",
      userId: 7,
      fillMode: "same_close",
      actions: ["buy", "hold", "sell"],
      ruleVersion: "sim30-mtm-v1",
      datasetVersion: "d1",
    }),
    true
  );
  const loaded = loadCloudGameDraft({ gameId: "g1", userId: 7 });
  assert.equal(loaded.gameId, "g1");
  assert.equal(loaded.userId, 7);
  assert.equal(loaded.fillMode, "same_close");
  assert.deepEqual(loaded.actions, ["buy", "hold", "sell"]);
  assert.equal(loadCloudGameDraft({ gameId: "other", userId: 7 }), null);
  assert.equal(loadCloudGameDraft({ gameId: "g1", userId: 8 }), null);
  clearCloudGameDraft("g1");
  assert.equal(localStorage.getItem(CLOUD_DRAFT_KEY), null);
});
