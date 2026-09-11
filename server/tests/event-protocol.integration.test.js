import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

// Dedicated process: enable event protocol before config import via startTestServer.
prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";

const { getSessionRow } = await import("../src/lib/games.js");
const { openDb } = await import("../src/db/connection.js");

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
  // Row written only with pre-009 columns still gets CHECK-compatible defaults when
  // inserting via explicit column list that omits new fields (simulate old writer).
  const db = openDb();
  const ds = db.prepare("SELECT version FROM datasets LIMIT 1").get();
  assert.ok(ds?.version);
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  // Ensure a user exists via register path in other tests; create one if needed.
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

test("create with flag on issues event-v1; state + thin advance + idempotency", async () => {
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
  assert.equal(state0.json.data.protocolVersion, "event-v1");
  assert.equal(state0.json.data.revision, 0);
  assert.deepEqual(state0.json.data.actions, []);
  assert.equal(state0.json.data.nextDecisionDay, 1);

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

  // Legacy batch finish still works on event-v1 rows (unchanged path).
  const actions = ["hold", ...holds(28)];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: {
      actions: actions.map((action, i) => ({ day: i + 1, action })),
      finish: true,
    },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
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
