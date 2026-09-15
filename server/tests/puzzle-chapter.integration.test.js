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
  seedPuzzleChapter2,
  seedPuzzleChapter3,
  seedPuzzleChapter4,
  seedAllPuzzleChapters,
  finishPuzzleGame,
  insertLevelVersionBump,
  firstClearRewardKey,
  threeStarRewardKey,
  PUZZLE_FIRST_CLEAR_REWARD,
  PUZZLE_RETRY_FEE,
  PUZZLE_THREE_STAR_REWARD,
  chapterTitle,
} = await import("../src/lib/puzzleChapter.js");
const {
  CHAPTER1_LEVEL_DEFS,
  CHAPTER2_LEVEL_DEFS,
  CHAPTER3_LEVEL_DEFS,
  CHAPTER4_LEVEL_DEFS,
} = await import("../src/lib/puzzleLevels.js");
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
  const lv0 = list.json.data.levels[0];
  assert.equal(lv0.levelKey, "ch1-01");
  assert.equal(lv0.version, CHAPTER1_LEVEL_DEFS[0].version);
  assert.ok(lv0.teachingBrief);
  assert.ok(lv0.openStateHint);
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
  assert.equal(first.json.data.game.levelKey, "ch1-01");
  assert.ok(Array.isArray(first.json.data.game.bars) && first.json.data.game.bars.length >= 6);
  assert.ok(
    Array.isArray(first.json.data.game.history) && first.json.data.game.history.length >= 20,
    "puzzle entry should include context history for K-line"
  );
  assert.equal(first.json.data.game.historyLength, first.json.data.game.history.length);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);

  const again = await startLevel(auth, "ch1-01", key);
  assert.equal(again.status, 200);
  assert.equal(again.json.data.resumed, true);
  assert.equal(again.json.data.game.gameId, first.json.data.game.gameId);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);
});

test("3★ settle grants +20 and +15 once; retry fee; version bump no double pay; 1★ no grant", async () => {
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
  assert.equal(s2.json.data.createFee, PUZZLE_RETRY_FEE);
  assert.equal(s2.json.data.charged, true);
  assert.equal(f2.json.data.stars, 3);
  assert.equal(f2.json.data.reward.grantedThisTime, true);
  assert.equal(f2.json.data.reward.amount, PUZZLE_FIRST_CLEAR_REWARD);
  assert.equal(f2.json.data.threeStarReward.grantedThisTime, true);
  assert.equal(f2.json.data.threeStarReward.amount, PUZZLE_THREE_STAR_REWARD);
  // -10 retry +20 first-clear +15 three-star
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 - PUZZLE_RETRY_FEE + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );
  assert.equal(hasRewardClaim(auth.user.id, threeStarRewardKey(def.rewardFamilyId)), true);

  const f2b = await finishLevel(auth, s2.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f2b.status, 200);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 - PUZZLE_RETRY_FEE + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );

  const s3 = await startLevel(auth, def.levelKey, `star-s3-${auth.user.id}`);
  assert.equal(s3.status, 201);
  assert.equal(s3.json.data.charged, true);
  const f3 = await finishLevel(auth, s3.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f3.status, 201, JSON.stringify(f3.json));
  assert.equal(f3.json.data.reward.grantedThisTime, false);
  assert.equal(f3.json.data.reward.alreadyClaimed, true);
  assert.equal(f3.json.data.threeStarReward.grantedThisTime, false);
  assert.equal(f3.json.data.threeStarReward.alreadyClaimed, true);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 - 2 * PUZZLE_RETRY_FEE + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );

  insertLevelVersionBump(def.levelKey);
  const s4 = await startLevel(auth, def.levelKey, `star-s4-${auth.user.id}`);
  assert.equal(s4.status, 201, JSON.stringify(s4.json));
  assert.match(s4.json.data.game.puzzleVersionId, new RegExp(`:v${def.version + 1}$`));
  const f4 = await finishLevel(auth, s4.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f4.status, 201, JSON.stringify(f4.json));
  assert.equal(f4.json.data.reward.grantedThisTime, false);
  assert.equal(f4.json.data.threeStarReward.grantedThisTime, false);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 - 3 * PUZZLE_RETRY_FEE + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );
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
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );
  const claims = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM reward_claims WHERE user_id=? AND reward_key=?`)
    .get(auth.user.id, firstClearRewardKey(def.rewardFamilyId)).c;
  assert.equal(claims, 1);
  const threeClaims = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM reward_claims WHERE user_id=? AND reward_key=?`)
    .get(auth.user.id, threeStarRewardKey(def.rewardFamilyId)).c;
  assert.equal(threeClaims, 1);
});

test("order budget rejection does not settle", async () => {
  const auth = await register(`pzbud${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[2];
  const st = await startLevel(auth, def.levelKey, `budget-${auth.user.id}`);
  assert.equal(st.status, 201);
  const decisionDays = def.gameDays - 1;
  const bad = ["buy", "sell", "buy", ...Array.from({ length: Math.max(0, decisionDays - 3) }, () => "hold")];
  assert.equal(bad.length, decisionDays);
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

test("progress: 1★ recorded; higher stars update best_stars; list DTO surfaces fields", async () => {
  const auth = await register(`pzprog${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[0]; // ch1-01
  const s1 = await startLevel(auth, def.levelKey, `prog-1-${auth.user.id}`);
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  const hold = Array.from({ length: def.gameDays - 1 }, () => "hold");
  const f1 = await finishLevel(auth, s1.json.data.game.gameId, hold);
  assert.equal(f1.status, 201, JSON.stringify(f1.json));
  assert.equal(f1.json.data.stars, 1);

  let list = await api("/api/v1/puzzles");
  assert.equal(list.status, 200);
  let lv = list.json.data.levels.find((l) => l.levelKey === def.levelKey);
  assert.ok(lv);
  assert.ok(lv.teachingBrief);
  assert.ok(lv.openStateHint);
  assert.equal(lv.version, def.version); // MAX(version) published
  assert.equal(lv.progress.bestStars, 1);

  const row1 = openDb()
    .prepare(`SELECT best_stars FROM puzzle_progress WHERE user_id=? AND level_key=?`)
    .get(auth.user.id, def.levelKey);
  assert.equal(row1.best_stars, 1);

  const s2 = await startLevel(auth, def.levelKey, `prog-3-${auth.user.id}`);
  assert.equal(s2.status, 201);
  const f2 = await finishLevel(auth, s2.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f2.status, 201, JSON.stringify(f2.json));
  assert.equal(f2.json.data.stars, 3);
  assert.equal(f2.json.data.reward.grantedThisTime, true);

  const row3 = openDb()
    .prepare(`SELECT best_stars FROM puzzle_progress WHERE user_id=? AND level_key=?`)
    .get(auth.user.id, def.levelKey);
  assert.equal(row3.best_stars, 3);

  list = await api("/api/v1/puzzles");
  lv = list.json.data.levels.find((l) => l.levelKey === def.levelKey);
  assert.equal(lv.progress.bestStars, 3);
});

test("T+1 day1 sell illegal on ch1-04 via finish API", async () => {
  const auth = await register(`pzt1${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[3];
  const st = await startLevel(auth, def.levelKey, `t1-${auth.user.id}`);
  assert.equal(st.status, 201);
  const bad = ["sell", ...Array.from({ length: def.gameDays - 2 }, () => "hold")];
  const fin = await finishLevel(auth, st.json.data.game.gameId, bad);
  assert.equal(fin.status, 422);
  assert.equal(fin.json.error.code, "INVALID_ACTION_SEQUENCE");
});

test("seed publishes 6 chapter-2 levels; list/start ch2", async () => {
  const seeded = seedPuzzleChapter2();
  assert.equal(seeded.created + seeded.skipped, 6);
  assert.equal(seeded.chapterId, "ch2");
  const n = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM puzzle_versions WHERE chapter_id='ch2' AND version=1`)
    .get().c;
  assert.equal(n, 6);
  const list = await api("/api/v1/puzzles?chapter=ch2");
  assert.equal(list.status, 200);
  assert.equal(list.json.data.status, "ready");
  assert.equal(list.json.data.chapterId, "ch2");
  assert.equal(list.json.data.title, chapterTitle("ch2"));
  assert.equal(list.json.data.levels.length, 6);
  assert.equal(list.json.data.levels[0].levelKey, "ch2-01");
  assert.equal(list.json.data.levels[0].version, CHAPTER2_LEVEL_DEFS[0].version);
  assert.ok(list.json.data.levels[0].teachingBrief);
  assert.equal(list.json.data.reward.chapterMax, 120);

  const auth = await register(`pzch2${Date.now().toString(36)}`);
  const start = await startLevel(auth, "ch2-01", `ch2-start-${auth.user.id}`);
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.data.game.levelKey, "ch2-01");
  assert.ok(Array.isArray(start.json.data.game.bars) && start.json.data.game.bars.length >= 6);
});

test("ch1 list still ready after ch2 seed (regression)", async () => {
  seedAllPuzzleChapters();
  const list = await api("/api/v1/puzzles?chapter=ch1");
  assert.equal(list.status, 200);
  assert.equal(list.json.data.chapterId, "ch1");
  assert.equal(list.json.data.levels.length, 6);
  assert.equal(list.json.data.levels[0].levelKey, "ch1-01");
});

test("ch2 first-clear cap is separate from ch1 families", async () => {
  const auth = await register(`pzcap${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  // Clear one ch1 and one ch2 at 3★ — both should grant (+20 each).
  const ch1 = CHAPTER1_LEVEL_DEFS[1];
  const ch2 = CHAPTER2_LEVEL_DEFS[0];
  const s1 = await startLevel(auth, ch1.levelKey, `cap-ch1-${auth.user.id}`);
  assert.equal(s1.status, 201);
  const f1 = await finishLevel(auth, s1.json.data.game.gameId, ch1.validatedThreeStarActions);
  assert.equal(f1.status, 201, JSON.stringify(f1.json));
  assert.equal(f1.json.data.stars, 3);
  assert.equal(f1.json.data.reward.grantedThisTime, true);

  const s2 = await startLevel(auth, ch2.levelKey, `cap-ch2-${auth.user.id}`);
  assert.equal(s2.status, 201, JSON.stringify(s2.json));
  const f2 = await finishLevel(auth, s2.json.data.game.gameId, ch2.validatedThreeStarActions);
  assert.equal(f2.status, 201, JSON.stringify(f2.json));
  assert.equal(f2.json.data.stars, 3);
  assert.equal(f2.json.data.reward.grantedThisTime, true);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 + PUZZLE_FIRST_CLEAR_REWARD * 2 + PUZZLE_THREE_STAR_REWARD * 2
  );

  const list2 = await api("/api/v1/puzzles?chapter=ch2");
  assert.equal(list2.status, 200);
  assert.equal(list2.json.data.reward.grantedCount, 1);
  const list1 = await api("/api/v1/puzzles?chapter=ch1");
  assert.equal(list1.status, 200);
  assert.equal(list1.json.data.reward.grantedCount, 1);
});

test("seed publishes 6 chapter-3 levels; list/start ch3", async () => {
  const seeded = seedPuzzleChapter3();
  assert.equal(seeded.created + seeded.skipped, 6);
  assert.equal(seeded.chapterId, "ch3");
  const n = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM puzzle_versions WHERE chapter_id='ch3' AND version=1`)
    .get().c;
  assert.equal(n, 6);
  const list = await api("/api/v1/puzzles?chapter=ch3");
  assert.equal(list.status, 200);
  assert.equal(list.json.data.status, "ready");
  assert.equal(list.json.data.chapterId, "ch3");
  assert.equal(list.json.data.title, chapterTitle("ch3"));
  assert.equal(list.json.data.levels.length, 6);
  assert.equal(list.json.data.levels[0].levelKey, "ch3-01");
  assert.equal(list.json.data.levels[0].version, CHAPTER3_LEVEL_DEFS[0].version);
  assert.ok(list.json.data.levels[0].teachingBrief);
  assert.equal(list.json.data.reward.chapterMax, 120);

  const auth = await register(`pzch3${Date.now().toString(36)}`);
  const start = await startLevel(auth, "ch3-01", `ch3-start-${auth.user.id}`);
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.data.game.levelKey, "ch3-01");
  assert.ok(Array.isArray(start.json.data.game.bars) && start.json.data.game.bars.length >= 6);
});

test("seed publishes 6 chapter-4 levels; list/start ch4", async () => {
  const seeded = seedPuzzleChapter4();
  assert.equal(seeded.created + seeded.skipped, 6);
  assert.equal(seeded.chapterId, "ch4");
  const n = openDb()
    .prepare(`SELECT COUNT(*) AS c FROM puzzle_versions WHERE chapter_id='ch4' AND version=1`)
    .get().c;
  assert.equal(n, 6);
  const list = await api("/api/v1/puzzles?chapter=ch4");
  assert.equal(list.status, 200);
  assert.equal(list.json.data.status, "ready");
  assert.equal(list.json.data.chapterId, "ch4");
  assert.equal(list.json.data.title, chapterTitle("ch4"));
  assert.equal(list.json.data.levels.length, 6);
  assert.equal(list.json.data.levels[0].levelKey, "ch4-01");
  assert.equal(list.json.data.levels[0].version, CHAPTER4_LEVEL_DEFS[0].version);

  const auth = await register(`pzch4${Date.now().toString(36)}`);
  const start = await startLevel(auth, "ch4-01", `ch4-start-${auth.user.id}`);
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.data.game.levelKey, "ch4-01");
});

test("ch1/ch2 list still ready after ch3+ch4 seed (regression)", async () => {
  seedAllPuzzleChapters();
  for (const ch of ["ch1", "ch2", "ch3", "ch4"]) {
    const list = await api(`/api/v1/puzzles?chapter=${ch}`);
    assert.equal(list.status, 200, ch);
    assert.equal(list.json.data.chapterId, ch);
    assert.equal(list.json.data.levels.length, 6, ch);
  }
});

test("ch3/ch4 first-clear caps are separate families", async () => {
  const auth = await register(`pzcap34${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  const ch3 = CHAPTER3_LEVEL_DEFS[0];
  const ch4 = CHAPTER4_LEVEL_DEFS[0];
  const s3 = await startLevel(auth, ch3.levelKey, `cap-ch3-${auth.user.id}`);
  assert.equal(s3.status, 201);
  const f3 = await finishLevel(auth, s3.json.data.game.gameId, ch3.validatedThreeStarActions);
  assert.equal(f3.status, 201, JSON.stringify(f3.json));
  assert.equal(f3.json.data.stars, 3);
  assert.equal(f3.json.data.reward.grantedThisTime, true);

  const s4 = await startLevel(auth, ch4.levelKey, `cap-ch4-${auth.user.id}`);
  assert.equal(s4.status, 201, JSON.stringify(s4.json));
  const f4 = await finishLevel(auth, s4.json.data.game.gameId, ch4.validatedThreeStarActions);
  assert.equal(f4.status, 201, JSON.stringify(f4.json));
  assert.equal(f4.json.data.stars, 3);
  assert.equal(f4.json.data.reward.grantedThisTime, true);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 + PUZZLE_FIRST_CLEAR_REWARD * 2 + PUZZLE_THREE_STAR_REWARD * 2
  );

  const list3 = await api("/api/v1/puzzles?chapter=ch3");
  assert.equal(list3.json.data.reward.grantedCount, 1);
  const list4 = await api("/api/v1/puzzles?chapter=ch4");
  assert.equal(list4.json.data.reward.grantedCount, 1);
});
