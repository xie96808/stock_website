import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
delete process.env.COIN_STAKE_ENABLED;
delete process.env.COIN_BOARD_ENABLED;

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => {
  await stop();
});

test("flags default off: config, stake create and coin board are closed; medals absent", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.coinStake, false);
  assert.equal(cfg.json.data.features.coinBoard, false);
  const auth = await register(`off${Date.now().toString(36)}`);
  const r = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-${Date.now()}` },
    body: { fillMode: "next_open", gameKind: "stake", stake: 50 },
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "FEATURE_DISABLED");
  const b = await api("/api/v1/leaderboard/coins?board=balance");
  assert.equal(b.status, 403);
  assert.ok(!("avatarMedal" in auth.user));
});
