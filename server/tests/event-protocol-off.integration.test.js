import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
// Explicitly ensure flag off (default).
delete process.env.EVENT_PROTOCOL_ENABLED;

const { getSessionRow } = await import("../src/lib/games.js");
const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("flag off: config false, create stays legacy-batch, decisions 403", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.protocolEventV1, false);

  const auth = await register(`off${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-create-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const row = getSessionRow(gameId);
  assert.equal(row.protocol_version, "legacy-batch");
  assert.equal(row.assist_class, "legacy");
  assert.equal(row.game_kind, "classic");
  assert.equal(row.revision, 0);

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.json.data.protocolVersion, "legacy-batch");

  const dec = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `off-dec-${Date.now()}` },
    body: { expectedRevision: 0, action: "hold" },
  });
  assert.equal(dec.status, 403);
  assert.equal(dec.json.error.code, "EVENT_PROTOCOL_DISABLED");
});

test("flag off: legacy finish leaves curve metrics null", async () => {
  const auth = await register(`leg${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `leg-create-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(holds(29)), finish: true },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
  assert.equal(finish.json.data.mddPpm, null);
  assert.equal(finish.json.data.benchmarkReturnPpm, null);
  assert.equal(finish.json.data.equityCurve, null);
  assert.equal(finish.json.data.scoreVersion, null);
});
