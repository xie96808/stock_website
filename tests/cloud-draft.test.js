import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDraftActions,
  saveCloudGameDraft,
  loadCloudGameDraft,
  clearCloudGameDraft,
  CLOUD_DRAFT_KEY,
  flushCloudDraftCoalesce,
  getCloudDraftWriteEpoch,
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
  assert.equal(loaded.revision, 1);
  assert.equal(loadCloudGameDraft({ gameId: "other", userId: 7 }), null);
  assert.equal(loadCloudGameDraft({ gameId: "g1", userId: 8 }), null);
  clearCloudGameDraft("g1");
  assert.equal(localStorage.getItem(CLOUD_DRAFT_KEY), null);
});

test("save refuses to overwrite a different gameId (stale writer)", () => {
  store.clear();
  assert.equal(
    saveCloudGameDraft({
      gameId: "g-a",
      userId: 1,
      fillMode: "next_open",
      actions: ["buy"],
    }),
    true
  );
  assert.equal(
    saveCloudGameDraft({
      gameId: "g-b",
      userId: 1,
      fillMode: "next_open",
      actions: ["sell"],
    }),
    false
  );
  const loaded = loadCloudGameDraft({ gameId: "g-a", userId: 1 });
  assert.equal(loaded.gameId, "g-a");
  assert.deepEqual(loaded.actions, ["buy"]);
});

test("save bumps revision; does not clobber newer revision", () => {
  store.clear();
  assert.equal(
    saveCloudGameDraft({
      gameId: "g1",
      userId: 2,
      fillMode: "next_open",
      actions: ["hold"],
    }),
    true
  );
  assert.equal(loadCloudGameDraft({ gameId: "g1" }).revision, 1);
  assert.equal(
    saveCloudGameDraft({
      gameId: "g1",
      userId: 2,
      fillMode: "next_open",
      actions: ["hold", "buy"],
    }),
    true
  );
  assert.equal(loadCloudGameDraft({ gameId: "g1" }).revision, 2);

  // Race: first read sees rev 1; before write, slot advances to rev 99.
  store.set(
    CLOUD_DRAFT_KEY,
    JSON.stringify({
      v: 1,
      gameId: "g1",
      userId: 2,
      fillMode: "next_open",
      actions: ["hold"],
      revision: 1,
      savedAt: "2026-01-01T00:00:00.000Z",
    })
  );
  const realGet = localStorage.getItem.bind(localStorage);
  let reads = 0;
  localStorage.getItem = (k) => {
    reads += 1;
    if (reads === 1) return realGet(k);
    store.set(
      CLOUD_DRAFT_KEY,
      JSON.stringify({
        v: 1,
        gameId: "g1",
        userId: 2,
        fillMode: "next_open",
        actions: ["hold", "buy", "sell"],
        revision: 99,
        savedAt: "2026-01-01T00:00:01.000Z",
      })
    );
    return realGet(k);
  };
  const ok = saveCloudGameDraft({
    gameId: "g1",
    userId: 2,
    fillMode: "next_open",
    actions: ["hold", "sell"],
  });
  localStorage.getItem = realGet;
  assert.equal(ok, false);
  const after = JSON.parse(realGet(CLOUD_DRAFT_KEY));
  assert.equal(after.revision, 99);
  assert.deepEqual(after.actions, ["hold", "buy", "sell"]);
});

test("clear only removes matching gameId", () => {
  store.clear();
  saveCloudGameDraft({
    gameId: "keep-me",
    userId: 3,
    fillMode: "next_open",
    actions: ["buy"],
  });
  assert.equal(clearCloudGameDraft("other"), false);
  assert.ok(loadCloudGameDraft({ gameId: "keep-me" }));
  assert.equal(clearCloudGameDraft("keep-me"), true);
  assert.equal(loadCloudGameDraft(), null);
});

test("clear without gameId wipes slot (new create)", () => {
  store.clear();
  saveCloudGameDraft({
    gameId: "g1",
    userId: 4,
    fillMode: "next_open",
    actions: ["sell"],
  });
  assert.equal(clearCloudGameDraft(), true);
  assert.equal(localStorage.getItem(CLOUD_DRAFT_KEY), null);
});

test("coalesced save aborted after clear (no resurrection)", async () => {
  store.clear();
  const epochBefore = getCloudDraftWriteEpoch();
  assert.equal(
    saveCloudGameDraft({
      gameId: "g-live",
      userId: 5,
      fillMode: "next_open",
      actions: ["buy", "hold"],
      coalesce: true,
    }),
    true
  );
  // Pending coalesce — clear matching game before microtask runs.
  assert.equal(clearCloudGameDraft("g-live"), true);
  assert.ok(getCloudDraftWriteEpoch() > epochBefore);
  // Microtask may still fire; flush helper / await tick then assert empty.
  await new Promise((r) => queueMicrotask(r));
  assert.equal(localStorage.getItem(CLOUD_DRAFT_KEY), null);
  assert.equal(flushCloudDraftCoalesce(), false);
});

test("coalesce keeps last payload for same game", async () => {
  store.clear();
  saveCloudGameDraft({
    gameId: "g1",
    userId: 6,
    fillMode: "next_open",
    actions: ["buy"],
    coalesce: true,
  });
  saveCloudGameDraft({
    gameId: "g1",
    userId: 6,
    fillMode: "next_open",
    actions: ["buy", "sell", "hold"],
    coalesce: true,
  });
  await new Promise((r) => queueMicrotask(r));
  const loaded = loadCloudGameDraft({ gameId: "g1", userId: 6 });
  assert.deepEqual(loaded.actions, ["buy", "sell", "hold"]);
  assert.equal(loaded.revision, 1);
});
