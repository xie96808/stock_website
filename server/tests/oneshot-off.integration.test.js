import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
delete process.env.ONESHOT_MODE_ENABLED;

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("flag off: config oneshotMode false; POST oneshot FEATURE_DISABLED", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.oneshotMode, false);
  assert.equal(cfg.json.data.features.survivalMode, false);

  const auth = await register(`offos${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-os-${Date.now()}` },
    body: {
      fillMode: "next_open",
      gameKind: "oneshot",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 403, JSON.stringify(create.json));
  assert.equal(create.json.error.code, "FEATURE_DISABLED");
});

test("unknown gameKind is rejected, not coerced to classic", async () => {
  const auth = await register(`badk${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `badk-${Date.now()}` },
    body: { fillMode: "next_open", gameKind: "duel" },
  });
  assert.equal(create.status, 400);
  assert.equal(create.json.error.code, "INVALID_GAME_KIND");
});

test("classic create still works when oneshot flag off", async () => {
  const auth = await register(`cl${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `cl-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.data.gameKind, "classic");
});
