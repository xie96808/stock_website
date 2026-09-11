import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.PUZZLE_CHAPTER_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const {
  seedPuzzleChapter1,
  finishPuzzleGame,
  insertLevelVersionBump,
  firstClearRewardKey,
  PUZZLE_FIRST_CLEAR_REWARD,
} = await import("../src/lib/puzzleChapter.js");
const { CHAPTER1_LEVEL_DEFS } = await import("../src/lib/puzzleLevels.js");
const { hasRewardClaim } = await import("../src/lib/rewardClaims.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

function actionsObj(list) {
  return list.map((action, i) => ({ day: i + 1, action }));
}

async function startLevel(auth, levelKey, key) {
  return api(`/api/v1/puzzles/${levelKey}/entries`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: {
      "Idempotency-Key":
        key || `pz-${levelKey}-${auth.user.id}-${Math.random().toString(36).slice(2)}`,
    },
    body: {},
  });
}

async function finishLevel(auth, gameId, actions) {
  return api(`/api/v1/puzzles/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(actions), finish: true },
  });
}

test("config exposes puzzleChapter when enabled", async () => {
  assert.equal(config.puzzleChapterEnabled, true);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.puzzleChapter, true);
});

test("seed publishes 6 chapter-1 levels", async () => {
  const seeded = seedPuzzleChapter1();
  assert.ok(seeded.created + seeded.skipped === 6);
  const n = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM puzzle_versions WHERE chapter_id='ch1'`)
    .get().c;
  assert.equal(n, 6);
  const list = await api("/api/v1/puzzles");
  assert.equal(list.status, 200);
  assert.equal(list.json.data.status, "ready");
  assert.equal(list.json.data.levels.length, 6);
  assert.equal(list.json.data.createFee, 0);
});

test("free create does not deduct jiu coin; resume idempotent", async () => {
  const auth = await register(`pzfree${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  assert.equal(bal0, JIU_COIN_REGISTER_GRANT);
  const key = `free-${auth.user.id}`;
  const first = await startLevel(auth, "ch1-01", key);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.data.charged, false);
  assert.equal(first.json.data.createFee, 0);
  assert.equal(first.json.data.game.gameKind, "puzzle");
  assert.equal(first.json.data.game.createFee, 0);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);

  const again = await startLevel(auth, "ch1-01", key);
  assert.equal(again.status, 200);
  assert.equal(again.json.data.resumed, true);
  assert.equal(again.json.data.game.gameId, first.json.data.game.gameId);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);
});

test("3★ settle grants +20 once; repeat and version bump no double pay; 1★ no grant", async () => {
  const auth = await register(`pzstar${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[1];
  const bal0 = getJiuCoinBalance(auth.user.id);

  const s1 = await startLevel(auth, def.levelKey, `star-s1-${auth.user.id}`);
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  const hold = Array.from({ length: def.gameDays - 1 }, () => "hold");
  const f1 = await finishLevel(auth, s1.json.data.game.gameId, hold);
  assert.equal(f1.status, 201, JSON.stringify(f1.json));
  assert.equal(f1.json.data.stars, 1);
  assert.equal(f1.json.data.reward.grantedThisTime, false);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);
  assert.equal(hasRewardClaim(auth.user.id, firstClearRewardKey(def.rewardFamilyId)), false);

  const s2 = await startLevel(auth, def.levelKey, `star-s2-${auth.user.id}`);
  assert.equal(s2.status, 201, JSON.stringify(s2.json));
  const f2 = await finishLevel(auth, s2.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f2.status, 201, JSON.stringify(f2.json));
  assert.equal(f2.json.data.stars, 3);
  assert.equal(f2.json.data.reward.grantedThisTime, true);
  assert.equal(f2.json.data.reward.amount, PUZZLE_FIRST_CLEAR_REWARD);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 + PUZZLE_FIRST_CLEAR_REWARD);

  const f2b = await finishLevel(auth, s2.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f2b.status, 200);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 + PUZZLE_FIRST_CLEAR_REWARD);

  const s3 = await startLevel(auth, def.levelKey, `star-s3-${auth.user.id}`);
  assert.equal(s3.status, 201);
  const f3 = await finishLevel(auth, s3.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f3.status, 201, JSON.stringify(f3.json));
  assert.equal(f3.json.data.reward.grantedThisTime, false);
  assert.equal(f3.json.data.reward.alreadyClaimed, true);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 + PUZZLE_FIRST_CLEAR_REWARD);

  insertLevelVersionBump(def.levelKey);
  const s4 = await startLevel(auth, def.levelKey, `star-s4-${auth.user.id}`);
  assert.equal(s4.status, 201, JSON.stringify(s4.json));
  assert.match(s4.json.data.game.puzzleVersionId, /:v2$/);
  const f4 = await finishLevel(auth, s4.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f4.status, 201, JSON.stringify(f4.json));
  assert.equal(f4.json.data.reward.grantedThisTime, false);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 + PUZZLE_FIRST_CLEAR_REWARD);
});

test("concurrent first-clear settle pays once", async () => {
  const auth = await register(`pzconc${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[0];
  const bal0 = getJiuCoinBalance(auth.user.id);
  const a = await startLevel(auth, def.levelKey, `conc-c1-${auth.user.id}`);
  const gameId = a.json.data.game.gameId;
  const body = { actions: actionsObj(def.validatedThreeStarActions), finish: true };
  const r1 = finishPuzzleGame(auth.user.id, gameId, body);
  const r2 = finishPuzzleGame(auth.user.id, gameId, body);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 + PUZZLE_FIRST_CLEAR_REWARD);
  const claims = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM reward_claims WHERE user_id=? AND reward_key=?`)
    .get(auth.user.id, firstClearRewardKey(def.rewardFamilyId)).c;
  assert.equal(claims, 1);
});

test("order budget rejection does not settle", async () => {
  const auth = await register(`pzbud${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[2];
  const st = await startLevel(auth, def.levelKey, `budget-${auth.user.id}`);
  assert.equal(st.status, 201);
  const bad = ["buy", "sell", "buy", "hold", "hold", "hold"];
  const fin = await finishLevel(auth, st.json.data.game.gameId, bad);
  assert.equal(fin.status, 422);
  assert.equal(fin.json.error.code, "INVALID_ACTION_SEQUENCE");
  const row = openDb()
    .prepare(`SELECT status FROM game_sessions WHERE id=?`)
    .get(st.json.data.game.gameId);
  assert.equal(row.status, "active");
});

test("flag off returns 404", async () => {
  const prev = config.puzzleChapterEnabled;
  config.puzzleChapterEnabled = false;
  try {
    const r = await api("/api/v1/puzzles");
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "PUZZLE_CHAPTER_DISABLED");
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.json.data.features.puzzleChapter, false);
  } finally {
    config.puzzleChapterEnabled = prev;
  }
});
