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
  assert.equal(typeof board.json.data.total, "number");
  assert.ok(board.json.data.total >= 1);
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


test("8 gameCount + winRate on board key", async () => {
  const auth = await register(`lb8${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const wins = [];
  for (let i = 0; i < 3; i++) {
    const g = await settleBuySell(auth, "next_open", `lb8-w-${Date.now()}-${i}`);
    forceResultRanking(g.gameId, {
      returnPpm: 100000 + i,
      finishedAt: `2026-09-07T0${i}:00:00.000Z`,
    });
    wins.push(g.gameId);
  }
  const loss = await settleBuySell(auth, "next_open", `lb8-l-${Date.now()}`);
  forceResultRanking(loss.gameId, {
    returnPpm: -50000,
    finishedAt: "2026-09-07T08:00:00.000Z",
  });
  // zero-buy settled valid still counts toward stats (me/stats filter), not ranking seat alone
  const zero = await settleHolds(auth, "next_open", `lb8-z-${Date.now()}`);
  forceResultRanking(zero.gameId, {
    returnPpm: 10,
    tradeCount: 0,
    finishedAt: "2026-09-07T09:00:00.000Z",
  });

  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.myRank >= 1);
  // 3 wins + 1 loss + 1 zero-buy with return>0 => 5 valid settled; wins with ppm>0 = 4
  assert.equal(board.json.data.myGameCount, 5);
  assert.equal(board.json.data.myWinRate, 80);
  const seat = board.json.data.top10.find((r) => r.rank === board.json.data.myRank);
  assert.ok(seat);
  assert.equal(seat.gameCount, 5);
  assert.equal(seat.winRate, 80);
});

test("9 in-memory board cache hit + invalidate on opt-in", async () => {
  const { getLeaderboardCacheStats, invalidateLeaderboardCache } = await import("../src/lib/leaderboard.js");
  invalidateLeaderboardCache();
  const before = getLeaderboardCacheStats().size;

  const a = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(a.status, a.json, 200);
  const mid = getLeaderboardCacheStats().size;
  assert.ok(mid >= before);

  const b = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(b.status, b.json, 200);
  assert.equal(b.json.data.total, a.json.data.total);
  assert.deepEqual(
    b.json.data.top10.map((r) => r.returnPpm),
    a.json.data.top10.map((r) => r.returnPpm)
  );

  const auth = await register(`lb9${Date.now().toString(36)}`);
  const settled = await settleBuySell(auth, "next_open", `lb9-${Date.now()}`);
  forceResultRanking(settled.gameId, {
    returnPpm: 654321,
    finishedAt: "2026-09-08T12:00:00.000Z",
  });
  // forceResultRanking invalidates; still not opted in → not on board
  let board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 654321));

  await optIn(auth.csrfToken);
  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 654321));
});

test("10 myRank outside top10 without returning full board", async () => {
  const stamp = Date.now().toString(36);
  const boardRule = `sim30-mtm-v1-lb10-${stamp}`;
  for (let i = 0; i < 12; i++) {
    const auth = await register(`lb10${stamp}${i}`);
    const nick = await api("/api/v1/me", {
      method: "PATCH",
      csrf: auth.csrfToken,
      body: { nickname: `速榜${i}`, leaderboardOptIn: true },
    });
    assertOk(nick.status, nick.json, 200);
    const g = await settleBuySell(auth, "same_close", `lb10-${stamp}-${i}`);
    forceResultRanking(g.gameId, {
      returnPpm: 400000 - i * 1000,
      finishedAt: `2026-09-08T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
      ruleVersion: boardRule,
    });
  }
  const board = await api(
    `/api/v1/leaderboard?fillMode=same_close&ruleVersion=${encodeURIComponent(boardRule)}`
  );
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.top10.length, 10);
  assert.equal(board.json.data.total, 12);
  assert.equal(board.json.data.myRank, 12);
  assert.ok(!board.json.data.top10.some((r) => r.nickname === "速榜11"));
});


test("11 metric=best default; average ranks by arithmetic mean not sum", async () => {
  const stamp = Date.now().toString(36);
  const boardRule = `sim30-mtm-v1-lb11-${stamp}`;

  // User A: one great game + one mediocre → high best, lower average
  const a = await register(`lb11a${stamp}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: a.csrfToken,
    body: { nickname: `均榜A${stamp}`, leaderboardOptIn: true },
  });
  const a1 = await settleBuySell(a, "next_open", `lb11-a1-${stamp}`);
  forceResultRanking(a1.gameId, {
    returnPpm: 400000, // +40%
    finishedAt: "2026-09-09T10:00:00.000Z",
    ruleVersion: boardRule,
  });
  const a2 = await settleBuySell(a, "next_open", `lb11-a2-${stamp}`);
  forceResultRanking(a2.gameId, {
    returnPpm: -100000, // -10%
    finishedAt: "2026-09-09T11:00:00.000Z",
    ruleVersion: boardRule,
  });
  // Arithmetic mean = 150000 (+15%); sum-of-pcts fallacy would be +30%

  // User B: two solid +20% → best 200000, average 200000
  const b = await register(`lb11b${stamp}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: b.csrfToken,
    body: { nickname: `均榜B${stamp}`, leaderboardOptIn: true },
  });
  const b1 = await settleBuySell(b, "next_open", `lb11-b1-${stamp}`);
  forceResultRanking(b1.gameId, {
    returnPpm: 200000,
    finishedAt: "2026-09-09T10:30:00.000Z",
    ruleVersion: boardRule,
  });
  const b2 = await settleBuySell(b, "next_open", `lb11-b2-${stamp}`);
  forceResultRanking(b2.gameId, {
    returnPpm: 200000,
    finishedAt: "2026-09-09T11:30:00.000Z",
    ruleVersion: boardRule,
  });

  const bestQ = `/api/v1/leaderboard?fillMode=next_open&ruleVersion=${encodeURIComponent(boardRule)}`;
  const best = await api(bestQ);
  assertOk(best.status, best.json, 200);
  assert.equal(best.json.data.metric, "best");
  assert.equal(best.json.data.top10[0].nickname, `均榜A${stamp}`);
  assert.equal(best.json.data.top10[0].returnPpm, 400000);
  assert.equal(best.json.data.top10[1].nickname, `均榜B${stamp}`);
  assert.equal(best.json.data.top10[1].returnPpm, 200000);

  const avg = await api(
    `/api/v1/leaderboard?fillMode=next_open&metric=average&ruleVersion=${encodeURIComponent(boardRule)}`
  );
  assertOk(avg.status, avg.json, 200);
  assert.equal(avg.json.data.metric, "average");
  // B avg 200000 > A avg 150000
  assert.equal(avg.json.data.top10[0].nickname, `均榜B${stamp}`);
  assert.equal(avg.json.data.top10[0].returnPpm, 200000);
  assert.equal(avg.json.data.top10[1].nickname, `均榜A${stamp}`);
  assert.equal(avg.json.data.top10[1].returnPpm, 150000);
  // Explicit: not ranking by summed percentage points (300000)
  assert.ok(!avg.json.data.top10.some((r) => r.returnPpm === 300000));

  // Logged in as B → myRank 1 on average, 2 on best
  assert.equal(avg.json.data.myRank, 1);
  const bestAsB = await api(`${bestQ}&metric=best`);
  assertOk(bestAsB.status, bestAsB.json, 200);
  assert.equal(bestAsB.json.data.myRank, 2);
});

test("12 average board eligibility + invalid metric", async () => {
  const auth = await register(`lb12${Date.now().toString(36)}`);
  await optIn(auth.csrfToken);
  const hidden = await settleBuySell(auth, "same_close", `lb12-h-${Date.now()}`);
  forceResultRanking(hidden.gameId, {
    returnPpm: 500000,
    leaderboardHidden: true,
    finishedAt: "2026-09-09T08:00:00.000Z",
  });
  const okGame = await settleBuySell(auth, "same_close", `lb12-ok-${Date.now()}`);
  forceResultRanking(okGame.gameId, {
    returnPpm: 100000,
    finishedAt: "2026-09-09T09:00:00.000Z",
  });
  const board = await api("/api/v1/leaderboard?fillMode=same_close&metric=average");
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.metric, "average");
  const seat = board.json.data.top10.find((r) => r.rank === board.json.data.myRank);
  assert.ok(seat);
  assert.equal(seat.returnPpm, 100000); // hidden 500000 excluded from average
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 500000));

  const bad = await api("/api/v1/leaderboard?fillMode=next_open&metric=sum");
  assert.equal(bad.status, 400);
  const code = bad.json?.error?.code || bad.json?.code;
  assert.equal(code, "INVALID_METRIC");
});

test("13 average myRank outside top10", async () => {
  const stamp = Date.now().toString(36);
  const boardRule = `sim30-mtm-v1-lb13-${stamp}`;
  for (let i = 0; i < 12; i++) {
    const auth = await register(`lb13${stamp}${i}`);
    await api("/api/v1/me", {
      method: "PATCH",
      csrf: auth.csrfToken,
      body: { nickname: `均名${i}`, leaderboardOptIn: true },
    });
    const g = await settleBuySell(auth, "next_open", `lb13-${stamp}-${i}`);
    forceResultRanking(g.gameId, {
      returnPpm: 300000 - i * 1000,
      finishedAt: `2026-09-09T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
      ruleVersion: boardRule,
    });
  }
  const board = await api(
    `/api/v1/leaderboard?fillMode=next_open&metric=average&ruleVersion=${encodeURIComponent(boardRule)}`
  );
  assertOk(board.status, board.json, 200);
  assert.equal(board.json.data.metric, "average");
  assert.equal(board.json.data.top10.length, 10);
  assert.equal(board.json.data.total, 12);
  assert.equal(board.json.data.myRank, 12);
  assert.ok(!board.json.data.top10.some((r) => r.nickname === "均名11"));
});
