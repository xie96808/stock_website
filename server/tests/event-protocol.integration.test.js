import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

// Dedicated process: enable event protocol before config import via startTestServer.
prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";

const { getSessionRow } = await import("../src/lib/games.js");
const { openDb } = await import("../src/db/connection.js");
const { SCORE_VERSION_CURVE_V1 } = await import("../../shared/equityCurve.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("config exposes protocolEventV1 when enabled", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.protocolEventV1, true);
});

test("migration defaults on legacy-shaped insert remain safe", async () => {
  const db = openDb();
  const ds = db.prepare("SELECT version FROM datasets LIMIT 1").get();
  assert.ok(ds?.version);
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  let userId = user?.id;
  if (!userId) {
    const auth = await register(`mig${Date.now().toString(36)}`);
    userId = auth.user.id;
  }
  const id = "00000000-0000-4000-8000-00000000b001";
  db.prepare(
    `INSERT INTO game_sessions (
      id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
      fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
      game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'next_open', '000001', '测', 0, 0, 30, 30, '{}', 'x', 'abandoned', datetime('now'), datetime('now'))`
  ).run(id, userId, `ck-mig-${Date.now()}`, "hash", "sim30-mtm-v1", ds.version);
  const row = db.prepare(`SELECT * FROM game_sessions WHERE id = ?`).get(id);
  assert.equal(row.game_kind, "classic");
  assert.equal(row.protocol_version, "legacy-batch");
  assert.equal(row.revision, 0);
  assert.equal(row.undo_count, 0);
  assert.equal(row.assist_class, "legacy");
  assert.equal(row.canonical_actions_json, null);
  assert.equal(row.challenge_id, null);
});

test("create + state hides identity/future bars; thin advance + idempotency", async () => {
  const auth = await register(`ev${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `ev-create-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const row = getSessionRow(gameId);
  assert.equal(row.protocol_version, "event-v1");
  assert.equal(row.assist_class, "clean");
  assert.equal(row.revision, 0);
  assert.equal(JSON.parse(row.canonical_actions_json).length, 0);

  const state0 = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state0.status, 200);
  const s0 = state0.json.data;
  assert.equal(s0.protocolVersion, "event-v1");
  assert.equal(s0.revision, 0);
  assert.deepEqual(s0.actions, []);
  assert.equal(s0.nextDecisionDay, 1);
  assert.equal(s0.revealedDay, 1);
  assert.ok(s0.visible);
  assert.equal(s0.visible.revealedDay, 1);
  assert.equal(s0.visible.bars.length, 1);
  assert.equal(s0.stockCode, undefined);
  assert.equal(s0.stockName, undefined);
  assert.equal(s0.stockIndex, undefined);

  const key = `dec-${Date.now()}`;
  const d1 = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: 0, action: "hold" },
  });
  assert.equal(d1.status, 200, JSON.stringify(d1.json));
  assert.equal(d1.json.data.revision, 1);
  assert.deepEqual(d1.json.data.actions, ["hold"]);
  assert.equal(d1.json.data.nextDecisionDay, 2);
  assert.equal(d1.json.data.revealedDay, 2);
  assert.equal(d1.json.data.visible.bars.length, 2);
  assert.equal(d1.json.data.stockCode, undefined);

  const replay = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: 0, action: "hold" },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.revision, 1);

  const conflict = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: 0, action: "buy" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "IDEMPOTENCY_CONFLICT");

  const revConflict = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `dec2-${Date.now()}` },
    body: { expectedRevision: 0, action: "buy" },
  });
  assert.equal(revConflict.status, 409);
  assert.equal(revConflict.json.error.code, "REVISION_CONFLICT");
});

test("event-v1 finish from canonical actions with curve metrics; client actions conflict", async () => {
  const auth = await register(`fin${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `fin-create-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;

  // Seed 29 holds via DB for speed (engine-valid), keep revision in sync.
  const db = openDb();
  const actions = holds(29);
  db.prepare(
    `UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`
  ).run(JSON.stringify(actions), gameId);

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.json.data.readyToSettle, true);
  assert.equal(state.json.data.revealedDay, 30);
  assert.equal(state.json.data.visible.bars.length, 30);
  assert.equal(state.json.data.stockCode, undefined);

  // Legacy-shaped finish without expectedRevision must fail on event-v1.
  const legacyFinish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: {
      actions: actions.map((action, i) => ({ day: i + 1, action })),
      finish: true,
    },
  });
  assert.equal(legacyFinish.status, 400);
  assert.equal(legacyFinish.json.error.code, "INVALID_REVISION");

  // Conflicting client actions rejected.
  const badActions = ["buy", ...holds(28)];
  const conflict = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `fin-bad-${Date.now()}` },
    body: {
      expectedRevision: 29,
      finish: true,
      actions: badActions.map((action, i) => ({ day: i + 1, action })),
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "SUBMISSION_CONFLICT");

  const finishKey = `fin-ok-${Date.now()}`;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": finishKey },
    body: { expectedRevision: 29, finish: true },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
  const data = finish.json.data;
  assert.equal(typeof data.returnPpm, "number");
  assert.equal(typeof data.mddPpm, "number");
  assert.equal(typeof data.benchmarkReturnPpm, "number");
  assert.ok(Array.isArray(data.equityCurve));
  assert.equal(data.equityCurve.length, 31);
  assert.equal(data.scoreVersion, SCORE_VERSION_CURVE_V1);
  assert.equal(data.assistClass, "clean");
  assert.ok(data.stockCode);
  assert.ok(data.stockName);

  const resultRow = db.prepare(`SELECT * FROM game_results WHERE game_id = ?`).get(gameId);
  assert.ok(resultRow.mdd_ppm != null);
  assert.ok(resultRow.benchmark_return_ppm != null);
  assert.ok(resultRow.equity_curve_json);
  assert.equal(resultRow.score_version, SCORE_VERSION_CURVE_V1);
  assert.equal(resultRow.assist_class, "clean");

  const sess = getSessionRow(gameId);
  assert.equal(sess.status, "settled");
  assert.equal(sess.revision, 30);

  // Idempotent retry
  const retry = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": finishKey },
    body: { expectedRevision: 29, finish: true },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.data.mddPpm, data.mddPpm);

  const stateDone = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(stateDone.status, 200);
  assert.equal(stateDone.json.data.status, "settled");
  assert.equal(stateDone.json.data.stockCode, data.stockCode);
});

test("decisions require auth", async () => {
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const r = await api("/api/v1/games/00000000-0000-4000-8000-000000000099/decisions", {
    method: "POST",
    headers: { "Idempotency-Key": "anon-dec-0001" },
    body: { expectedRevision: 0, action: "hold" },
  });
  assert.equal(r.status, 401);
});
