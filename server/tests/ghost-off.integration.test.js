import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.DAILY_CHALLENGE_ENABLED = "1";
delete process.env.GHOST_DUEL_ENABLED;

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("flag off: config ghostDuel false; ghost API FEATURE_DISABLED", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.ghostDuel, false);

  const preview = await api("/api/v1/daily-challenge/ghost");
  assert.equal(preview.status, 403);
  assert.equal(preview.json.error.code, "FEATURE_DISABLED");

  const auth = await register(`ghoff${Date.now().toString(36)}`);
  const create = await api("/api/v1/daily-challenge/ghost/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `ghoff-${Date.now()}` },
    body: {},
  });
  assert.equal(create.status, 403);
  assert.equal(create.json.error.code, "FEATURE_DISABLED");
});

test("daily challenge still works when ghost flag off", async () => {
  const auth = await register(`ghcl${Date.now().toString(36)}`);
  const start = await api("/api/v1/daily-challenge/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `ghcl-d-${Date.now()}` },
    body: {},
  });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.data.game.gameKind, "daily");
});
