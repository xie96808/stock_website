import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
delete process.env.PUZZLE_CHAPTER_ENABLED;

const { config } = await import("../src/lib/config.js");
const ctx = await startTestServer();
const { api, stop } = ctx;

test.after(async () => {
  await stop();
});

test("puzzle chapter default off", async () => {
  assert.equal(config.puzzleChapterEnabled, false);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.puzzleChapter, false);
  const r = await api("/api/v1/puzzles");
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, "PUZZLE_CHAPTER_DISABLED");
});
