import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.DAILY_CHALLENGE_ENABLED = "1";
process.env.GHOST_DUEL_ENABLED = "1";
// Shanghai 2026-09-10 12:00 — seed + settle "yesterday" later after clock bump.
process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-09-10T04:00:00.000Z"));

const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance, JIU_COIN_GAME_CREATE_COST } = await import("../src/lib/jiuCoin.js");
const {
  seedNearDailyChallenges,
  challengeNow,
  shanghaiYmdAt,
} = await import("../src/lib/dailyChallenge.js");
const { GHOST_DUEL_COST } = await import("../src/lib/ghostDuel.js");
const { config } = await import("../src/lib/config.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

async function startDaily(auth, key) {
  return api("/api/v1/daily-challenge/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: {},
  });
}

async function finishHold(auth, gameId) {
  return api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `fin-${gameId}` },
    body: { actions: actionsObj(holds()), finish: true },
  });
}

async function startGhost(auth, key) {
  return api("/api/v1/daily-challenge/ghost/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: {},
  });
}

test("config exposes ghostDuel when enabled", async () => {
  assert.equal(config.ghostDuelEnabled, true);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.ghostDuel, true);
});

test("empty ghost day: NO_GHOST preview; POST fails clearly", async () => {
  seedNearDailyChallenges(challengeNow());
  // Still on Sep 10 — yesterday Sep 9 may exist as challenge but no board entries.
  const preview = await api("/api/v1/daily-challenge/ghost");
  assert.equal(preview.status, 200);
  assert.equal(preview.json.data.available, false);
  assert.ok(["NO_GHOST", "CHALLENGE_MISSING", "NO_REPLAY"].includes(preview.json.data.reason));
  assert.equal(preview.json.data.ghost, null);

  const auth = await register(`ghemp${Date.now().toString(36)}`);
  const create = await startGhost(auth, `ghemp-${Date.now()}`);
  assert.ok(create.status === 404 || create.status === 409, JSON.stringify(create.json));
  assert.ok(["NO_GHOST", "CHALLENGE_MISSING", "NO_REPLAY"].includes(create.json.error.code));
});

test("yesterday #1 becomes ghost with name+avatar; lockstep window; no daily attempt", async () => {
  seedNearDailyChallenges(challengeNow());
  const owner = await register(`ghown${Date.now().toString(36)}`);
  const started = await startDaily(owner, `gh-own-daily-${owner.user.id}`);
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const dailyGame = started.json.data.game;
  assert.equal(dailyGame.gameKind, "daily");
  const ownerYmd = shanghaiYmdAt(challengeNow());

  const fin = await finishHold(owner, dailyGame.gameId);
  assert.ok(fin.status === 201 || fin.status === 200, JSON.stringify(fin.json));

  const board = await api("/api/v1/daily-challenge/leaderboard");
  assert.equal(board.status, 200);
  const top = board.json.data.entries?.[0];
  assert.ok(top, "owner should be on board");
  assert.equal(top.userId, owner.user.id);
  assert.ok(top.nickname);
  assert.ok(top.avatarId != null);

  // Advance to next Shanghai day so owner's run is "yesterday".
  process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-09-11T04:00:00.000Z"));
  seedNearDailyChallenges(challengeNow());

  const preview = await api("/api/v1/daily-challenge/ghost");
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.data.available, true);
  assert.equal(preview.json.data.sourceDate, ownerYmd);
  assert.equal(preview.json.data.ghost.nickname, top.nickname);
  assert.equal(preview.json.data.ghost.avatarId, top.avatarId);
  assert.equal(preview.json.data.ghost.label, "幽灵");
  assert.ok(!("actions" in preview.json.data.ghost));

  const challenger = await register(`ghchal${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(challenger.user.id);
  const create = await startGhost(challenger, `gh-chal-${challenger.user.id}`);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(GHOST_DUEL_COST, JIU_COIN_GAME_CREATE_COST);
  assert.equal(getJiuCoinBalance(challenger.user.id), bal0 - GHOST_DUEL_COST);

  const game = create.json.data.game;
  assert.equal(game.gameKind, "ghost");
  assert.equal(game.protocolVersion, "legacy-batch");
  assert.equal(game.challengeId, dailyGame.challengeId);
  assert.equal(game.stockIndex, dailyGame.stockIndex);
  assert.equal(game.windowStartIndex, dailyGame.windowStartIndex);
  assert.ok(game.modifiers?.ghost, "modifiers.ghost required for HUD");
  assert.equal(game.modifiers.ghost.nickname, top.nickname);
  assert.equal(game.modifiers.ghost.avatarId, top.avatarId);
  assert.ok(Array.isArray(game.modifiers.ghost.actions));
  assert.equal(game.modifiers.ghost.actions.length, 29);
  assert.equal(create.json.data.ghost.nickname, top.nickname);

  // No daily_challenge_attempts row for ghost game.
  const att = openDb()
    .prepare(`SELECT * FROM daily_challenge_attempts WHERE game_id = ?`)
    .get(game.gameId);
  assert.equal(att, undefined);

  // ACTIVE mutex vs classic
  const classic = await api("/api/v1/games", {
    method: "POST",
    csrf: challenger.csrfToken,
    headers: { "Idempotency-Key": `gh-cl-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(classic.status, 409);
  assert.equal(classic.json.error.code, "ACTIVE_GAME_EXISTS");

  // Idempotent resume
  const again = await startGhost(challenger, `gh-chal-${challenger.user.id}`);
  assert.equal(again.status, 200);
  assert.equal(again.json.data.resumed, true);
  assert.equal(again.json.data.game.gameId, game.gameId);
  assert.equal(getJiuCoinBalance(challenger.user.id), bal0 - GHOST_DUEL_COST);

  // Finish ghost does not pollute today's daily board
  const gFin = await finishHold(challenger, game.gameId);
  assert.ok(gFin.status === 201 || gFin.status === 200, JSON.stringify(gFin.json));
  const todayBoard = await api("/api/v1/daily-challenge/leaderboard");
  assert.equal(todayBoard.status, 200);
  const ghostOnBoard = (todayBoard.json.data.entries || []).find(
    (e) => e.userId === challenger.user.id
  );
  assert.equal(ghostOnBoard, undefined);

  // Classic still works after ghost settled
  const classic2 = await api("/api/v1/games", {
    method: "POST",
    csrf: challenger.csrfToken,
    headers: { "Idempotency-Key": `gh-cl2-${Date.now()}` },
    body: {
      fillMode: "next_open",
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assert.equal(classic2.status, 201, JSON.stringify(classic2.json));
  assert.equal(classic2.json.data.gameKind, "classic");
});
