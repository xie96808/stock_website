import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
process.env.ONESHOT_MODE_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";

const { getSessionRow } = await import("../src/lib/games.js");
const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

function pick() {
  return { stockIndex: 0, windowStartIndex: 30, historyLength: 30 };
}

async function createKind(auth, kind, key) {
  return api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { fillMode: "next_open", gameKind: kind, pick: pick() },
  });
}

async function decide(auth, gameId, revision, action, key) {
  return api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { expectedRevision: revision, action },
  });
}

test("config exposes oneshotMode when enabled", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.oneshotMode, true);
  assert.equal(cfg.json.data.features.survivalMode, false);
});

test("create oneshot: 30 韭币, modifiers, event-v1, ACTIVE mutex", async () => {
  const auth = await register(`os${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  const create = await createKind(auth, "oneshot", `os-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.data.gameKind, "oneshot");
  assert.deepEqual(create.json.data.modifiers, { maxBuys: 1, maxSells: 1 });
  const row = getSessionRow(create.json.data.gameId);
  assert.equal(row.game_kind, "oneshot");
  assert.equal(row.modifiers, JSON.stringify({ maxBuys: 1, maxSells: 1 }));
  assert.equal(row.protocol_version, "event-v1");
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - 30);

  const classic = await createKind(auth, "classic", `os-cl-${Date.now()}`);
  assert.equal(classic.status, 409);
  assert.equal(classic.json.error.code, "ACTIVE_GAME_EXISTS");

  const survival = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `surv-${Date.now()}` },
    body: { fillMode: "next_open", gameKind: "survival", pick: pick() },
  });
  assert.equal(survival.status, 403);
  assert.equal(survival.json.error.code, "FEATURE_DISABLED");
});

test("oneshot second buy → ORDER_LIMIT; board unchanged; classic still multi-buy", async () => {
  const auth = await register(`lim${Date.now().toString(36)}`);
  const create = await createKind(auth, "oneshot", `lim-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;

  const b1 = await decide(auth, gameId, 0, "buy", `lim-b1-${Date.now()}`);
  assert.equal(b1.status, 200, JSON.stringify(b1.json));
  const s1 = await decide(auth, gameId, 1, "sell", `lim-s1-${Date.now()}`);
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  const b2 = await decide(auth, gameId, 2, "buy", `lim-b2-${Date.now()}`);
  assert.equal(b2.status, 409, JSON.stringify(b2.json));
  assert.equal(b2.json.error.code, "ORDER_LIMIT");

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.status, 200);
  assert.deepEqual(state.json.data.actions, ["buy", "sell"]);
  assert.equal(state.json.data.revision, 2);

  const h = await decide(auth, gameId, 2, "hold", `lim-h-${Date.now()}`);
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.deepEqual(h.json.data.actions, ["buy", "sell", "hold"]);
});

test("oneshot rewind rejected; classic rewind still allowed", async () => {
  const auth = await register(`rw${Date.now().toString(36)}`);
  const os = await createKind(auth, "oneshot", `rw-os-${Date.now()}`);
  assert.equal(os.status, 201, JSON.stringify(os.json));
  const osId = os.json.data.gameId;
  const d = await decide(auth, osId, 0, "hold", `rw-d-${Date.now()}`);
  assert.equal(d.status, 200);
  const rewind = await api(`/api/v1/games/${osId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-os-r-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(rewind.status, 409, JSON.stringify(rewind.json));
  assert.equal(rewind.json.error.code, "REWIND_NOT_ALLOWED");

  await api(`/api/v1/games/${osId}/abandon`, { method: "POST", csrf: auth.csrfToken });

  const cl = await createKind(auth, "classic", `rw-cl-${Date.now()}`);
  assert.equal(cl.status, 201, JSON.stringify(cl.json));
  const clId = cl.json.data.gameId;
  const cd = await decide(auth, clId, 0, "hold", `rw-cl-d-${Date.now()}`);
  assert.equal(cd.status, 200);
  const crw = await api(`/api/v1/games/${clId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-cl-r-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(crw.status, 200, JSON.stringify(crw.json));
});

test("oneshot settle buy+sell+holds; not on classic leaderboard", async () => {
  const auth = await register(`lbos${Date.now().toString(36)}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: auth.csrfToken,
    body: { leaderboardOptIn: true },
  });
  const create = await createKind(auth, "oneshot", `lbos-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const db = openDb();
  const actions = ["buy", "sell", ...holds(27)];
  db.prepare(`UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`).run(
    JSON.stringify(actions),
    gameId
  );
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `lbos-f-${Date.now()}` },
    body: { finish: true, expectedRevision: 29 },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
  assert.equal(getSessionRow(gameId).game_kind, "oneshot");

  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assert.equal(board.status, 200);
  assert.equal(board.json.data.myRank, null);
  const stats = await api("/api/v1/me/stats?fillMode=next_open");
  assert.equal(stats.status, 200);
  assert.equal(stats.json.data.count, 0);
});

test("classic still allows a second buy after sell", async () => {
  const auth = await register(`cl2${Date.now().toString(36)}`);
  const create = await createKind(auth, "classic", `cl2-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  assert.equal((await decide(auth, gameId, 0, "buy", `cl2-b1-${Date.now()}`)).status, 200);
  assert.equal((await decide(auth, gameId, 1, "sell", `cl2-s1-${Date.now()}`)).status, 200);
  const b2 = await decide(auth, gameId, 2, "buy", `cl2-b2-${Date.now()}`);
  assert.equal(b2.status, 200, JSON.stringify(b2.json));
  assert.deepEqual(b2.json.data.actions, ["buy", "sell", "buy"]);
});
