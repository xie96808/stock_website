import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
delete process.env.GAME_REWIND_ENABLED;

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("rewind disabled by default; leaderboard has no assistClass", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.gameRewind, false);

  const auth = await register(`rwoff${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-c-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201);
  const gameId = create.json.data.gameId;
  await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-d-${Date.now()}` },
    body: { expectedRevision: 0, action: "hold" },
  });
  const rw = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-r-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(rw.status, 403);
  assert.equal(rw.json.error.code, "GAME_REWIND_DISABLED");

  const lb = await api("/api/v1/leaderboard?fillMode=next_open&metric=best&assistClass=clean");
  assert.equal(lb.status, 200);
  assert.equal(lb.json.data.assistClass, null);
});
