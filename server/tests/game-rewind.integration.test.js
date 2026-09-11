import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";

const { getSessionRow } = await import("../src/lib/games.js");
const { openDb } = await import("../src/db/connection.js");
const { REWIND_COST } = await import("../src/lib/gameRewind.js");
const { ASSIST_CLEAN, ASSIST_UNDO } = await import("../../shared/protocol.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

async function createEventGame(auth, fillMode = "next_open") {
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    body: {
      fillMode,
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  return create.json.data.gameId;
}

async function decide(auth, gameId, expectedRevision, action, key = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const r = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision, action },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

test("config exposes gameRewind when enabled", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.gameRewind, true);
  assert.equal(cfg.json.data.features.protocolEventV1, true);
});

test("balance 49 keeps game; 50 succeeds to 0; mark persists", async () => {
  const auth = await register(`rw49${Date.now().toString(36)}`);
  const gameId = await createEventGame(auth);
  await decide(auth, gameId, 0, "hold");

  const db = openDb();
  db.prepare(`UPDATE users SET jiu_coin_balance = 49 WHERE id = ?`).run(auth.user.id);

  const fail = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-fail-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(fail.status, 402);
  assert.equal(fail.json.error.code, "INSUFFICIENT_FUNDS");
  const sessFail = getSessionRow(gameId);
  assert.equal(sessFail.revision, 1);
  assert.equal(sessFail.undo_count, 0);
  assert.equal(sessFail.assist_class, ASSIST_CLEAN);
  assert.deepEqual(JSON.parse(sessFail.canonical_actions_json), ["hold"]);
  assert.equal(db.prepare(`SELECT jiu_coin_balance AS b FROM users WHERE id = ?`).get(auth.user.id).b, 49);

  db.prepare(`UPDATE users SET jiu_coin_balance = 50 WHERE id = ?`).run(auth.user.id);
  const ok = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-ok-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const data = ok.json.data;
  assert.equal(data.undoCount, 1);
  assert.equal(data.assistClass, ASSIST_UNDO);
  assert.equal(data.revision, 2);
  assert.deepEqual(data.actions, []);
  assert.equal(data.revokedAction, "hold");
  assert.equal(data.restoredDecisionDay, 1);
  assert.equal(data.balanceBefore, 50);
  assert.equal(data.balanceAfter, 0);
  assert.equal(data.canRewind, false);
  assert.equal(db.prepare(`SELECT jiu_coin_balance AS b FROM users WHERE id = ?`).get(auth.user.id).b, 0);

  const claim = db
    .prepare(`SELECT * FROM reward_claims WHERE user_id = ? AND reward_key = ?`)
    .get(auth.user.id, `game:${gameId}:rewind`);
  assert.ok(claim);
  assert.equal(claim.amount, REWIND_COST);

  const cmd = db
    .prepare(`SELECT * FROM game_commands WHERE game_id = ? AND type = 'rewind'`)
    .get(gameId);
  assert.ok(cmd);
  assert.equal(JSON.parse(cmd.event_json).revokedAction, "hold");

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.json.data.undoCount, 1);
  assert.equal(state.json.data.assistClass, ASSIST_UNDO);
  assert.equal(state.json.data.canRewind, false);
});

test("double-click same idempotency key once; second rewind rejected", async () => {
  const auth = await register(`rw2x${Date.now().toString(36)}`);
  const gameId = await createEventGame(auth, "same_close");
  await decide(auth, gameId, 0, "buy");
  const db = openDb();
  db.prepare(`UPDATE users SET jiu_coin_balance = 100 WHERE id = ?`).run(auth.user.id);

  const key = `rw-dup-${Date.now()}`;
  const a = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: 1 },
  });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const bal = a.json.data.balanceAfter;

  const b = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: 1 },
  });
  assert.equal(b.status, 200);
  assert.equal(b.json.data.balanceAfter, bal);
  assert.equal(b.json.data.revision, a.json.data.revision);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS c FROM reward_claims WHERE user_id = ? AND reward_key = ?`).get(
      auth.user.id,
      `game:${gameId}:rewind`
    ).c,
    1
  );
  assert.equal(db.prepare(`SELECT jiu_coin_balance AS x FROM users WHERE id = ?`).get(auth.user.id).x, 50);

  // After success, a new key must fail (already used).
  const again = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-again-${Date.now()}` },
    body: { expectedRevision: a.json.data.revision },
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "REWIND_ALREADY_USED");
});

test("rewind after 1st decision restores empty; T+1 consistent after buy rewind", async () => {
  const auth = await register(`rwT1${Date.now().toString(36)}`);
  const gameId = await createEventGame(auth, "next_open");
  const afterBuy = await decide(auth, gameId, 0, "buy");
  assert.equal(afterBuy.revision, 1);
  // Day 2 reveal after buy; position should be locked on server replay of [buy].
  const db = openDb();
  db.prepare(`UPDATE users SET jiu_coin_balance = 80 WHERE id = ?`).run(auth.user.id);

  const rw = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-t1-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(rw.status, 200, JSON.stringify(rw.json));
  assert.deepEqual(rw.json.data.actions, []);
  assert.equal(rw.json.data.nextDecisionDay, 1);
  assert.equal(rw.json.data.revealedDay, 1);

  // Re-buy then hold: T+1 unlock path still valid via decisions.
  await decide(auth, gameId, rw.json.data.revision, "buy");
  const hold = await decide(auth, gameId, rw.json.data.revision + 1, "hold");
  assert.equal(hold.actions.length, 2);
  assert.equal(hold.assistClass, ASSIST_UNDO);
});

test("rewind after 29th decision (ready_to_settle) before finish", async () => {
  const auth = await register(`rw29${Date.now().toString(36)}`);
  const gameId = await createEventGame(auth);
  const db = openDb();
  const actions = holds(29);
  db.prepare(
    `UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`
  ).run(JSON.stringify(actions), gameId);
  db.prepare(`UPDATE users SET jiu_coin_balance = 50 WHERE id = ?`).run(auth.user.id);

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.json.data.readyToSettle, true);
  assert.equal(state.json.data.canRewind, true);
  assert.equal(state.json.data.revealedDay, 30);

  const rw = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-29-${Date.now()}` },
    body: { expectedRevision: 29 },
  });
  assert.equal(rw.status, 200, JSON.stringify(rw.json));
  assert.equal(rw.json.data.actions.length, 28);
  assert.equal(rw.json.data.readyToSettle, false);
  assert.equal(rw.json.data.nextDecisionDay, 29);
  assert.equal(rw.json.data.revealedDay, 29);
  assert.equal(rw.json.data.revokedAction, "hold");
  assert.equal(rw.json.data.assistClass, ASSIST_UNDO);
  assert.equal(rw.json.data.undoCount, 1);
});

test("rewind vs settle race: only one wins", async () => {
  const auth = await register(`race${Date.now().toString(36)}`);
  const gameId = await createEventGame(auth);
  const db = openDb();
  db.prepare(
    `UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`
  ).run(JSON.stringify(holds(29)), gameId);
  db.prepare(`UPDATE users SET jiu_coin_balance = 100 WHERE id = ?`).run(auth.user.id);

  const [finish, rewind] = await Promise.all([
    api(`/api/v1/games/${gameId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `fin-race-${Date.now()}` },
      body: { expectedRevision: 29, finish: true },
    }),
    api(`/api/v1/games/${gameId}/rewind`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `rw-race-${Date.now()}` },
      body: { expectedRevision: 29 },
    }),
  ]);

  const statuses = [finish.status, rewind.status].sort();
  // One success (200/201), one conflict/gone-style failure
  const okCount = [finish, rewind].filter((r) => r.status === 200 || r.status === 201).length;
  const failCount = [finish, rewind].filter((r) => r.status >= 400).length;
  assert.equal(okCount, 1, JSON.stringify({ finish: finish.json, rewind: rewind.json }));
  assert.equal(failCount, 1);

  const sess = getSessionRow(gameId);
  if (finish.status === 201 || finish.status === 200) {
    assert.equal(sess.status, "settled");
    assert.equal(sess.undo_count, 0);
  } else {
    assert.equal(sess.status, "active");
    assert.equal(sess.undo_count, 1);
    assert.equal(JSON.parse(sess.canonical_actions_json).length, 28);
  }
});

test("assist boards: clean default excludes undo; undo board isolated", async () => {
  const auth = await register(`board${Date.now().toString(36)}`);
  // Opt in for boards
  openDb()
    .prepare(`UPDATE users SET leaderboard_opt_in = 1, jiu_coin_balance = 200 WHERE id = ?`)
    .run(auth.user.id);

  async function settleClean() {
    const gameId = await createEventGame(auth);
    const db = openDb();
    db.prepare(
      `UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`
    ).run(JSON.stringify(holds(29)), gameId);
    const fin = await api(`/api/v1/games/${gameId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `fin-c-${Date.now()}-${Math.random()}` },
      body: { expectedRevision: 29, finish: true },
    });
    assert.ok(fin.status === 201 || fin.status === 200, JSON.stringify(fin.json));
    // force trade_count eligible
    db.prepare(`UPDATE game_results SET trade_count = 1, return_ppm = 12345 WHERE game_id = ?`).run(gameId);
    return gameId;
  }

  async function settleUndo() {
    const gameId = await createEventGame(auth);
    await decide(auth, gameId, 0, "hold");
    const db = openDb();
    const rw = await api(`/api/v1/games/${gameId}/rewind`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `rw-b-${Date.now()}` },
      body: { expectedRevision: 1 },
    });
    assert.equal(rw.status, 200, JSON.stringify(rw.json));
    db.prepare(
      `UPDATE game_sessions SET canonical_actions_json = ?, revision = ? WHERE id = ?`
    ).run(JSON.stringify(holds(29)), rw.json.data.revision + 28, gameId);
    // Keep undo mark; bump revision to match action count path used by finish
    const row = getSessionRow(gameId);
    db.prepare(
      `UPDATE game_sessions SET canonical_actions_json = ?, revision = 40, undo_count = 1, assist_class = 'undo' WHERE id = ?`
    ).run(JSON.stringify(holds(29)), gameId);
    const fin = await api(`/api/v1/games/${gameId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `fin-u-${Date.now()}` },
      body: { expectedRevision: 40, finish: true },
    });
    assert.ok(fin.status === 201 || fin.status === 200, JSON.stringify(fin.json));
    assert.equal(fin.json.data.assistClass, ASSIST_UNDO);
    db.prepare(`UPDATE game_results SET trade_count = 1, return_ppm = 99999 WHERE game_id = ?`).run(gameId);
    return gameId;
  }

  await settleClean();
  await settleUndo();

  const { invalidateLeaderboardCache } = await import("../src/lib/leaderboard.js");
  invalidateLeaderboardCache();

  const clean = await api("/api/v1/leaderboard?fillMode=next_open&metric=best");
  assert.equal(clean.status, 200);
  assert.equal(clean.json.data.assistClass, ASSIST_CLEAN);
  const cleanMine = clean.json.data.myRank;
  assert.ok(cleanMine != null);

  const undo = await api("/api/v1/leaderboard?fillMode=next_open&metric=best&assistClass=undo");
  assert.equal(undo.status, 200);
  assert.equal(undo.json.data.assistClass, ASSIST_UNDO);
  // Undo board should see the high ppm seat
  assert.ok(undo.json.data.total >= 1);

  const statsClean = await api("/api/v1/me/stats?fillMode=next_open");
  assert.equal(statsClean.status, 200);
  assert.equal(statsClean.json.data.filters.assistClass, ASSIST_CLEAN);
});
