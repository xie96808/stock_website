import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();

const { settleGame } = await import("../../shared/engine.js");
const { getSessionRow, countResults, backdateExpiresAt } = await import("../src/lib/games.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

function assertOk(status, json, expectStatus) {
  assert.equal(status, expectStatus, JSON.stringify(json));
  assert.ok(json?.data != null || expectStatus === 204);
}

test("P0 auth required to create/finish", async () => {
  const c = await api("/api/v1/games", {
    method: "POST",
    headers: { "Idempotency-Key": "anon-create-1" },
    body: { fillMode: "next_open" },
  });
  assert.equal(c.status, 401);

  const f = await api("/api/v1/games/00000000-0000-4000-8000-000000000001/finish", {
    method: "POST",
    body: { actions: holds(29), finish: true },
  });
  assert.equal(f.status, 401);
});

test("P0 create + finish next_open happy path; returnPpm matches engine", async () => {
  const auth = await register(`no${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-next-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;
  assert.equal(create.json.data.fillMode, "next_open");
  assert.equal(create.json.data.ruleVersion, "sim30-mtm-v1");
  assert.ok(create.json.data.datasetVersion);
  assert.equal(create.json.data.stockIndex, 0);
  assert.equal(create.json.data.windowStartIndex, 30);

  const actions = ["buy", "sell", ...holds(27)];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(actions), finish: true, returnPct: "999.99", returnPpm: 999999 },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.returnPpm, 100000);
  assert.equal(finish.json.data.returnPct, "10.00");
  assert.equal(finish.json.data.tradeCount, 2);

  const row = getSessionRow(gameId);
  const snap = JSON.parse(row.snapshot_json);
  const local = settleGame({ fillMode: "next_open", bars: snap.bars, actions });
  assert.equal(local.ok, true);
  assert.equal(finish.json.data.returnPpm, local.returnPpm);
  assert.equal(finish.json.data.tradeCount, local.tradeCount);
});

test("P0 create + finish same_close happy path", async () => {
  const auth = await register(`sc${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-sc-${Date.now()}` },
    body: {
      fillMode: "same_close",
      pick: { stockIndex: 1, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;
  const actions = ["buy", "sell", ...holds(27)];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions, finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.returnPpm, -100000);
  assert.equal(finish.json.data.tradeCount, 2);
});

test("P0 idempotent create + finish retry no double row", async () => {
  const auth = await register(`id${Date.now().toString(36)}`);
  const key = `idem-${Date.now()}`;
  const body = {
    fillMode: "next_open",
    pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
  };
  const c1 = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body,
  });
  const c2 = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body,
  });
  assertOk(c1.status, c1.json, 201);
  assertOk(c2.status, c2.json, 200);
  assert.equal(c1.json.data.gameId, c2.json.data.gameId);

  const gameId = c1.json.data.gameId;
  const actions = holds(29);
  const f1 = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions, finish: true },
  });
  const f2 = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions, finish: true },
  });
  assertOk(f1.status, f1.json, 201);
  assertOk(f2.status, f2.json, 200);
  assert.equal(f1.json.data.returnPpm, f2.json.data.returnPpm);
  assert.equal(countResults(gameId), 1);
});

test("P0 illegal sell-when-flat → 422, still active", async () => {
  const auth = await register(`il${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-il-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const bad = ["sell", ...holds(28)];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: bad, finish: true },
  });
  assert.equal(finish.status, 422);
  assert.equal(finish.json.error.code, "INVALID_ACTION_SEQUENCE");
  const active = await api("/api/v1/games/active", { csrf: auth.csrfToken });
  assert.equal(active.status, 200);
  assert.equal(active.json.data.gameId, gameId);
  assert.equal(active.json.data.status, "active");
});

test("P0 second active blocked / abandon then create", async () => {
  const auth = await register(`ab${Date.now().toString(36)}`);
  const c1 = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-a1-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(c1.status, c1.json, 201);
  const c2 = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-a2-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(c2.status, 409);
  assert.equal(c2.json.error.code, "ACTIVE_GAME_EXISTS");

  const abd = await api(`/api/v1/games/${c1.json.data.gameId}/abandon`, {
    method: "POST",
    csrf: auth.csrfToken,
  });
  assert.equal(abd.status, 204);

  const c3 = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-a3-${Date.now()}` },
    body: {
      fillMode: "same_close",
      pick: { stockIndex: 1, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(c3.status, c3.json, 201);
  assert.notEqual(c3.json.data.gameId, c1.json.data.gameId);
});

test("P0 finish with forged returnPct ignored", async () => {
  const auth = await register(`fg${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-fg-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: {
      actions: holds(29),
      finish: true,
      returnPct: "88.88",
      returnPpm: 888800,
      trades: [{ type: "buy", day: 1, price: 1 }],
    },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.returnPpm, 0);
  assert.equal(finish.json.data.returnPct, "0.00");
  assert.equal(finish.json.data.tradeCount, 0);
});

test("P0 foreign gameId → 404", async () => {
  const a = await register(`fa${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: a.csrfToken,
    headers: { "Idempotency-Key": `k-fa-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;

  // Switch identity to user B (register clears jar).
  const b = await register(`fb${Date.now().toString(36)}`);
  const get = await api(`/api/v1/games/${gameId}`, { csrf: b.csrfToken });
  assert.equal(get.status, 404);
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: b.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assert.equal(finish.status, 404);
});

test("P0 Day29 buy next_open → valuation, tradeCount buy only", async () => {
  const auth = await register(`d29${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-d29-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const actions = [...holds(28), "buy"];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions, finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  // fixture: day30 open=10 close=11 → buy at open 10, value at close 11 → +10%
  assert.equal(finish.json.data.returnPpm, 100000);
  assert.equal(finish.json.data.tradeCount, 1);
  assert.ok(finish.json.data.valuation);
  assert.equal(finish.json.data.valuation.kind, "valuation");
  assert.equal(finish.json.data.valuation.day, 30);
});

test("P0 29 holds → 0% saved, tradeCount 0", async () => {
  const auth = await register(`h0${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-h0-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.returnPpm, 0);
  assert.equal(finish.json.data.tradeCount, 0);
  const list = await api("/api/v1/me/games", { csrf: auth.csrfToken });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.some((g) => g.gameId === gameId));
});

test("P1 expired game reject finish", async () => {
  const auth = await register(`ex${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-ex-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  backdateExpiresAt(gameId, "2000-01-01T00:00:00.000Z");
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assert.equal(finish.status, 410);
  assert.equal(finish.json.error.code, "GAME_EXPIRED");
});

test("P1 dataset/rule version stamped on result", async () => {
  const auth = await register(`ver${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-ver-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const ds = create.json.data.datasetVersion;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.ruleVersion, "sim30-mtm-v1");
  assert.equal(finish.json.data.datasetVersion, ds);
  const detail = await api(`/api/v1/games/${gameId}`, { csrf: auth.csrfToken });
  assert.equal(detail.json.data.datasetVersion, ds);
  assert.equal(detail.json.data.ruleVersion, "sim30-mtm-v1");
});

test("P1 me/games pagination limit", async () => {
  const auth = await register(`pg${Date.now().toString(36)}`);
  for (let i = 0; i < 3; i++) {
    const create = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `k-pg-${Date.now()}-${i}` },
      body: {
        fillMode: "next_open",
        pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
      },
    });
    await api(`/api/v1/games/${create.json.data.gameId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      body: { actions: holds(29), finish: true },
    });
  }
  const page1 = await api("/api/v1/me/games?limit=2", { csrf: auth.csrfToken });
  assert.equal(page1.status, 200);
  assert.equal(page1.json.data.items.length, 2);
  assert.ok(page1.json.data.nextCursor);
  const page2 = await api(
    `/api/v1/me/games?limit=2&cursor=${encodeURIComponent(page1.json.data.nextCursor)}`,
    { csrf: auth.csrfToken }
  );
  assert.equal(page2.status, 200);
  assert.ok(page2.json.data.items.length >= 1);
  const ids = new Set([
    ...page1.json.data.items.map((x) => x.gameId),
    ...page2.json.data.items.map((x) => x.gameId),
  ]);
  assert.ok(ids.size >= 3);

  const stats = await api("/api/v1/me/stats", { csrf: auth.csrfToken });
  assert.equal(stats.status, 200);
  assert.ok(stats.json.data.count >= 3);
});

test("P1 concurrent identical finish → single result", async () => {
  const auth = await register(`cc${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-cc-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const body = { actions: holds(29), finish: true };
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      api(`/api/v1/games/${gameId}/finish`, {
        method: "POST",
        csrf: auth.csrfToken,
        body,
      })
    )
  );
  const okStatuses = results.filter((r) => r.status === 200 || r.status === 201);
  assert.equal(okStatuses.length, 8);
  assert.equal(countResults(gameId), 1);
  const ppms = new Set(okStatuses.map((r) => r.json.data.returnPpm));
  assert.equal(ppms.size, 1);
});

test("P0 conflicting finish payload → 409", async () => {
  const auth = await register(`cf${Date.now().toString(36)}`);
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `k-cf-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  const gameId = create.json.data.gameId;
  const f1 = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assertOk(f1.status, f1.json, 201);
  const f2 = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: ["buy", ...holds(28)], finish: true },
  });
  assert.equal(f2.status, 409);
});
