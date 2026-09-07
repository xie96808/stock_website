import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();

const { forceResultRanking } = await import("../src/lib/leaderboard.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

test.after(async () => {
  await stop();
});

function assertOk(status, json, expectStatus) {
  assert.equal(status, expectStatus, JSON.stringify(json));
  assert.ok(json?.data != null || expectStatus === 204);
}

async function optIn(csrf) {
  const r = await api("/api/v1/me", {
    method: "PATCH",
    csrf,
    body: { leaderboardOptIn: true },
  });
  assertOk(r.status, r.json, 200);
  assert.equal(r.json.data.user.leaderboardOptIn, true);
  return r.json.data.user;
}

async function settleBuySell(auth, fillMode, key, pick = { stockIndex: 0, windowStartIndex: 30, historyLength: 30 }) {
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: { fillMode, pick },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;
  const actions = ["buy", "sell", ...holds(27)];
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(actions), finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  return { gameId, result: finish.json.data };
}

async function settleHolds(auth, fillMode, key) {
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: {
      fillMode,
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: holds(29), finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  assert.equal(finish.json.data.tradeCount, 0);
  return { gameId, result: finish.json.data };
}

function clearJar() {
  for (const k of Object.keys(jar)) delete jar[k];
}

test("1 separate boards per fill_mode", async () => {
  const auth = await register(`lb1${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const next = await settleBuySell(auth, "next_open", `lb1-next-${Date.now()}`);
  forceResultRanking(next.gameId, { returnPpm: 250000, finishedAt: "2026-09-01T10:00:00.000Z" });

  const same = await settleBuySell(
    auth,
    "same_close",
    `lb1-same-${Date.now()}`,
    { stockIndex: 1, windowStartIndex: 30, historyLength: 30 }
  );
  forceResultRanking(same.gameId, { returnPpm: -150000, finishedAt: "2026-09-01T11:00:00.000Z" });

  const boardNext = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(boardNext.status, boardNext.json, 200);
  assert.equal(boardNext.json.data.fillMode, "next_open");
  assert.ok(boardNext.json.data.top10.some((r) => r.returnPpm === 250000));
  assert.ok(!boardNext.json.data.top10.some((r) => r.returnPpm === -150000));

  const boardSame = await api("/api/v1/leaderboard?fillMode=same_close");
  assertOk(boardSame.status, boardSame.json, 200);
  assert.equal(boardSame.json.data.fillMode, "same_close");
  assert.ok(boardSame.json.data.top10.some((r) => r.returnPpm === -150000));
  assert.ok(!boardSame.json.data.top10.some((r) => r.returnPpm === 250000));
});

test("2 same user multi games → one seat (best)", async () => {
  const auth = await register(`lb2${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const g1 = await settleBuySell(auth, "next_open", `lb2-a-${Date.now()}`);
  forceResultRanking(g1.gameId, { returnPpm: 100000, finishedAt: "2026-09-02T08:00:00.000Z" });
  const g2 = await settleBuySell(auth, "next_open", `lb2-b-${Date.now()}`);
  forceResultRanking(g2.gameId, { returnPpm: 300000, finishedAt: "2026-09-02T09:00:00.000Z" });
  const g3 = await settleBuySell(auth, "next_open", `lb2-c-${Date.now()}`);
  forceResultRanking(g3.gameId, { returnPpm: 200000, finishedAt: "2026-09-02T07:00:00.000Z" });

  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.myRank != null, true);
  const seat = board.json.data.top10.find((r) => r.returnPpm === 300000 && r.rank === board.json.data.myRank);
  assert.ok(seat, "best 300000 should be the seat");
  assert.equal(board.json.data.top10.filter((r) => r.rank === board.json.data.myRank).length, 1);
  const ppmList = board.json.data.top10.map((r) => r.returnPpm);
  assert.ok(ppmList.includes(300000));
});

test("3 opt_in false excluded; enable → appears", async () => {
  const auth = await register(`lb3${Date.now().toString(36)}`);
  const settled = await settleBuySell(auth, "next_open", `lb3-${Date.now()}`);
  forceResultRanking(settled.gameId, {
    returnPpm: 777000,
    finishedAt: "2026-09-03T12:00:00.000Z",
  });

  let board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.myRank, null);
  assert.equal(board.json.data.ineligibilityReason, "not_opted_in");
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 777000));

  await optIn(auth.csrfToken);
  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.myRank >= 1);
  assert.equal(board.json.data.ineligibilityReason, null);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 777000));
});

test("4 zero-buy not ranked", async () => {
  const auth = await register(`lb4${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const zero = await settleHolds(auth, "next_open", `lb4-hold-${Date.now()}`);
  forceResultRanking(zero.gameId, {
    returnPpm: 999999,
    finishedAt: "2026-09-04T10:00:00.000Z",
  });
  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 999999));
  assert.equal(board.json.data.myRank, null);
  assert.equal(board.json.data.ineligibilityReason, "no_eligible_game");
});

test("5 Top10 order + myRank when outside top10", async () => {
  const stamp = Date.now().toString(36);
  const boardRule = `sim30-mtm-v1-lb5-${stamp}`;
  for (let i = 0; i < 12; i++) {
    const auth = await register(`lb5${stamp}${i}`);
    const nick = await api("/api/v1/me", {
      method: "PATCH",
      csrf: auth.csrfToken,
      body: { nickname: `榜友${i}`, leaderboardOptIn: true },
    });
    assertOk(nick.status, nick.json, 200);
    const g = await settleBuySell(auth, "next_open", `lb5-${stamp}-${i}`);
    forceResultRanking(g.gameId, {
      returnPpm: 500000 - i * 1000,
      finishedAt: `2026-09-05T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
      ruleVersion: boardRule,
    });
  }

  const board = await api(`/api/v1/leaderboard?fillMode=next_open&ruleVersion=${encodeURIComponent(boardRule)}`);
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.ruleVersion, boardRule);
  assert.equal(board.json.data.top10.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(board.json.data.top10[i].rank, i + 1);
    assert.equal(board.json.data.top10[i].returnPpm, 500000 - i * 1000);
    assert.equal(board.json.data.top10[i].nickname, `榜友${i}`);
  }
  const ranks = board.json.data.top10.map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(board.json.data.myRank, 12);
  assert.equal(board.json.data.ineligibilityReason, null);
  assert.ok(!board.json.data.top10.some((r) => r.nickname === "榜友11"));
});

test("6 unauthenticated public read OK, no private fields", async () => {
  clearJar();
  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.myRank, null);
  assert.equal(board.json.data.ineligibilityReason, null);
  assert.ok(board.json.data.asOf);
  assert.ok(board.json.data.ruleVersion);
  assert.ok(board.json.data.datasetVersion);
  const blob = JSON.stringify(board.json.data);
  assert.equal(/username/i.test(blob), false);
  assert.equal(/password/i.test(blob), false);
  assert.equal(/recovery/i.test(blob), false);
  assert.equal(/session/i.test(blob), false);
  for (const row of board.json.data.top10) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, "username"), false);
    assert.ok(row.nickname != null);
    assert.ok(row.avatarId != null);
    assert.ok(row.returnPpm != null);
    assert.ok(row.returnPct != null);
    assert.ok(row.finishedAt != null);
    assert.ok(row.rank >= 1);
  }

  const bad = await api("/api/v1/leaderboard");
  assert.equal(bad.status, 400);
});

test("7 hidden/invalid excluded", async () => {
  const auth = await register(`lb7${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const hidden = await settleBuySell(auth, "next_open", `lb7-h-${Date.now()}`);
  forceResultRanking(hidden.gameId, {
    returnPpm: 888001,
    leaderboardHidden: true,
    finishedAt: "2026-09-06T08:00:00.000Z",
  });
  const invalid = await settleBuySell(auth, "next_open", `lb7-i-${Date.now()}`);
  forceResultRanking(invalid.gameId, {
    returnPpm: 888002,
    validity: "invalid",
    finishedAt: "2026-09-06T09:00:00.000Z",
  });
  const okGame = await settleBuySell(auth, "next_open", `lb7-ok-${Date.now()}`);
  forceResultRanking(okGame.gameId, {
    returnPpm: 120000,
    finishedAt: "2026-09-06T10:00:00.000Z",
  });

  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 888001));
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 888002));
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 120000));
});

test("config advertises leaderboard feature", async () => {
  const cfg = await api("/api/v1/config");
  assertOk(cfg.status, cfg.json, 200);
  assert.equal(cfg.json.data.features.leaderboard, true);
});
