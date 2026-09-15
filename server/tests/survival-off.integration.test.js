import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
delete process.env.SURVIVAL_MODE_ENABLED;

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("flag off: config survivalMode false; POST survival FEATURE_DISABLED", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.survivalMode, false);

  const auth = await register(`offsv${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-sv-${Date.now()}` },
    body: {
      fillMode: "next_open",
      gameKind: "survival",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 403, JSON.stringify(create.json));
  assert.equal(create.json.error.code, "FEATURE_DISABLED");
});
