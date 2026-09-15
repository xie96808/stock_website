import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
process.env.SURVIVAL_MODE_ENABLED = "1";
process.env.ONESHOT_MODE_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";

const { getSessionRow } = await import("../src/lib/games.js");
const { openDb } = await import("../src/db/connection.js");
const { forceResultRanking, invalidateLeaderboardCache } = await import("../src/lib/leaderboard.js");
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
    body: { fillMode: "same_close", gameKind: kind, pick: pick() },
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

/** Overwrite session bars so day-1 buy @100 then crash to 79 (−21%). */
function plantCrashBars(gameId) {
  const db = openDb();
  const row = db.prepare(`SELECT snapshot_json FROM game_sessions WHERE id = ?`).get(gameId);
  const snap = JSON.parse(row.snapshot_json);
  const bars = [];
  for (let i = 0; i < 30; i++) {
    const c = i === 0 ? 100 : 79;
    bars.push({
      date: `D${i + 1}`,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    });
  }
  snap.bars = bars;
  db.prepare(`UPDATE game_sessions SET snapshot_json = ? WHERE id = ?`).run(
    JSON.stringify(snap),
    gameId
  );
}

/** Flat / mild path — never hits −20% if flat or tiny moves. */
function plantFlatBars(gameId) {
  const db = openDb();
  const row = db.prepare(`SELECT snapshot_json FROM game_sessions WHERE id = ?`).get(gameId);
  const snap = JSON.parse(row.snapshot_json);
  const bars = [];
  for (let i = 0; i < 30; i++) {
    const c = 100 + (i % 3);
    bars.push({
      date: `D${i + 1}`,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    });
  }
  snap.bars = bars;
  db.prepare(`UPDATE game_sessions SET snapshot_json = ? WHERE id = ?`).run(
    JSON.stringify(snap),
    gameId
  );
}

test("config exposes survivalMode when enabled", async () => {
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.survivalMode, true);
});

test("create survival: 20 韭币, modifiers, ACTIVE mutex with classic", async () => {
  const auth = await register(`sv${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  const create = await createKind(auth, "survival", `sv-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.data.gameKind, "survival");
  assert.deepEqual(create.json.data.modifiers, {
    bustNavPpm: -200000,
    bustBasis: "start_nav",
  });
  const row = getSessionRow(create.json.data.gameId);
  assert.equal(row.game_kind, "survival");
  assert.equal(row.protocol_version, "event-v1");
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - 20);

  const classic = await createKind(auth, "classic", `sv-cl-${Date.now()}`);
  assert.equal(classic.status, 409);
  assert.equal(classic.json.error.code, "ACTIVE_GAME_EXISTS");
});

test("survival bust on MTM vs start NAV → auto-finish busted; no further K", async () => {
  const auth = await register(`bust${Date.now().toString(36)}`);
  const create = await createKind(auth, "survival", `bust-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  plantCrashBars(gameId);

  const buy = await decide(auth, gameId, 0, "buy", `bust-b-${Date.now()}`);
  assert.equal(buy.status, 200, JSON.stringify(buy.json));
  // Day-1 same_close buy fills @100; MTM still 100 → not bust yet
  assert.notEqual(buy.json.data.status, "settled");

  const hold = await decide(auth, gameId, 1, "hold", `bust-h-${Date.now()}`);
  assert.equal(hold.status, 200, JSON.stringify(hold.json));
  assert.equal(hold.json.data.status, "settled");
  assert.equal(hold.json.data.busted, true);
  assert.ok(hold.json.data.returnPpm <= -200000, JSON.stringify(hold.json.data));

  const again = await decide(auth, gameId, 2, "hold", `bust-x-${Date.now()}`);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "GAME_NOT_ACTIVE");

  const row = getSessionRow(gameId);
  assert.equal(row.status, "settled");
});

test("peak give-back to start is NOT bust (start_nav basis)", async () => {
  const auth = await register(`peak${Date.now().toString(36)}`);
  const create = await createKind(auth, "survival", `peak-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  const db = openDb();
  const row0 = db.prepare(`SELECT snapshot_json FROM game_sessions WHERE id = ?`).get(gameId);
  const snap = JSON.parse(row0.snapshot_json);
  // buy@100, rally to 150, back to 100 — MDD from peak huge, vs start ~0
  const bars = [];
  for (let i = 0; i < 30; i++) {
    let c = 100;
    if (i >= 1 && i < 6) c = 100 + i * 10;
    bars.push({ date: `D${i + 1}`, open: c, high: c, low: c, close: c, volume: 1 });
  }
  snap.bars = bars;
  db.prepare(`UPDATE game_sessions SET snapshot_json = ? WHERE id = ?`).run(
    JSON.stringify(snap),
    gameId
  );

  assert.equal((await decide(auth, gameId, 0, "buy", `peak-b-${Date.now()}`)).status, 200);
  let rev = 1;
  for (let i = 0; i < 8; i++) {
    const d = await decide(auth, gameId, rev, "hold", `peak-h${i}-${Date.now()}`);
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.notEqual(d.json.data.status, "settled");
    assert.equal(d.json.data.busted, false);
    rev += 1;
  }
});

test("survival rewind rejected; not on classic leaderboard after survive", async () => {
  const auth = await register(`svrl${Date.now().toString(36)}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: auth.csrfToken,
    body: { leaderboardOptIn: true },
  });
  const create = await createKind(auth, "survival", `svrl-c-${Date.now()}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;
  plantFlatBars(gameId);

  const d0 = await decide(auth, gameId, 0, "hold", `svrl-d-${Date.now()}`);
  assert.equal(d0.status, 200);
  const rewind = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `svrl-rw-${Date.now()}` },
    body: { expectedRevision: 1 },
  });
  assert.equal(rewind.status, 409, JSON.stringify(rewind.json));
  assert.equal(rewind.json.error.code, "REWIND_NOT_ALLOWED");

  const db = openDb();
  const actions = ["hold", ...holds(28)];
  db.prepare(`UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`).run(
    JSON.stringify(actions),
    gameId
  );
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `svrl-f-${Date.now()}` },
    body: { finish: true, expectedRevision: 29 },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));
  assert.equal(finish.json.data.busted, false);
  assert.equal(getSessionRow(gameId).game_kind, "survival");

  const board = await api("/api/v1/leaderboard?fillMode=same_close");
  assert.equal(board.status, 200);
  assert.equal(board.json.data.gameKind, "classic");
  assert.equal(board.json.data.myRank, null);
  const stats = await api("/api/v1/me/stats?fillMode=same_close");
  assert.equal(stats.status, 200);
  assert.equal(stats.json.data.count, 0);

  // Hold-only has trade_count=0 → still not on survival board eligibility.
  const survEmpty = await api("/api/v1/leaderboard?fillMode=same_close&gameKind=survival");
  assert.equal(survEmpty.status, 200);
  assert.equal(survEmpty.json.data.gameKind, "survival");
  assert.equal(survEmpty.json.data.myRank, null);
});

test("survival board: only survival kind; 活穿 ranks above 爆仓", async () => {
  const stamp = Date.now().toString(36);

  async function settleSurvivalBuy(auth, keySuffix, plantFn) {
    const create = await createKind(auth, "survival", `svlb-${keySuffix}-${stamp}`);
    assert.equal(create.status, 201, JSON.stringify(create.json));
    const gameId = create.json.data.gameId;
    plantFn(gameId);
    const db = openDb();
    const actions = ["buy", ...holds(28)];
    db.prepare(`UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`).run(
      JSON.stringify(actions),
      gameId
    );
    const finish = await api(`/api/v1/games/${gameId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `svlb-f-${keySuffix}-${stamp}` },
      body: { finish: true, expectedRevision: 29 },
    });
    // Crash path may auto-bust earlier; accept settled 201 or already settled from bust.
    assert.ok([200, 201].includes(finish.status) || finish.json?.data?.busted != null, JSON.stringify(finish.json));
    return gameId;
  }

  // Survivor with modest return
  const aliveAuth = await register(`sva${stamp}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: aliveAuth.csrfToken,
    body: { leaderboardOptIn: true },
  });
  const aliveId = await settleSurvivalBuy(aliveAuth, "alive", plantFlatBars);
  // Ensure valuation marks survived; force modest return
  {
    const db = openDb();
    const row = db.prepare(`SELECT valuation_json FROM game_results WHERE game_id = ?`).get(aliveId);
    let val = row?.valuation_json ? JSON.parse(row.valuation_json) : { kind: "valuation" };
    val = { ...val, busted: false };
    db.prepare(
      `UPDATE game_results SET return_ppm = ?, trade_count = MAX(trade_count, 1), valuation_json = ?, validity = 'valid', leaderboard_hidden = 0 WHERE game_id = ?`
    ).run(50000, JSON.stringify(val), aliveId);
    forceResultRanking(aliveId, { returnPpm: 50000, finishedAt: "2026-09-10T10:00:00.000Z" });
  }

  // Bust with higher return — still ranks below survivor
  const bustAuth = await register(`svb${stamp}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: bustAuth.csrfToken,
    body: { leaderboardOptIn: true },
  });
  const bustId = await settleSurvivalBuy(bustAuth, "bust", plantCrashBars);
  {
    const db = openDb();
    const val = { kind: "bust", busted: true, day: 2 };
    db.prepare(
      `UPDATE game_results SET return_ppm = ?, trade_count = MAX(trade_count, 1), valuation_json = ?, validity = 'valid', leaderboard_hidden = 0 WHERE game_id = ?`
    ).run(400000, JSON.stringify(val), bustId);
    forceResultRanking(bustId, { returnPpm: 400000, finishedAt: "2026-09-10T09:00:00.000Z" });
  }

  invalidateLeaderboardCache();

  const classic = await api("/api/v1/leaderboard?fillMode=same_close&gameKind=classic");
  assert.equal(classic.status, 200);
  assert.equal(classic.json.data.myRank, null); // logged in as bustAuth from jar — still not classic

  const oneshot = await api("/api/v1/leaderboard?fillMode=same_close&gameKind=oneshot");
  assert.equal(oneshot.status, 200);
  assert.equal(oneshot.json.data.total, 0);

  // Guest board — check ordering by nicknames
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const surv = await api("/api/v1/leaderboard?fillMode=same_close&gameKind=survival&metric=best");
  assert.equal(surv.status, 200);
  assert.equal(surv.json.data.gameKind, "survival");
  assert.ok(surv.json.data.total >= 2, JSON.stringify(surv.json.data));
  const top = surv.json.data.top10;
  const aliveRow = top.find((r) => r.returnPpm === 50000);
  const bustRow = top.find((r) => r.returnPpm === 400000);
  assert.ok(aliveRow, "survivor on board");
  assert.ok(bustRow, "bust on board");
  assert.equal(aliveRow.busted, false);
  assert.equal(bustRow.busted, true);
  assert.ok(aliveRow.rank < bustRow.rank, `alive #${aliveRow.rank} should beat bust #${bustRow.rank}`);
});
