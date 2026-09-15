import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.PUZZLE_CHAPTER_ENABLED = "1";
process.env.PUZZLE_WEEKLY_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const {
  seedAllPuzzleChapters,
  PUZZLE_RETRY_FEE,
  PUZZLE_THREE_STAR_REWARD,
  PUZZLE_FIRST_CLEAR_REWARD,
} = await import("../src/lib/puzzleChapter.js");
const {
  shanghaiIsoWeekId,
  shanghaiIsoWeekBounds,
  featuredLevelKeyForWeek,
  getPuzzleWeeklyBoard,
} = await import("../src/lib/puzzleWeekly.js");
const {
  CHAPTER1_LEVEL_DEFS,
  CHAPTER2_LEVEL_DEFS,
  CHAPTER3_LEVEL_DEFS,
  CHAPTER4_LEVEL_DEFS,
  ALL_PUZZLE_LEVEL_DEFS,
} = await import("../src/lib/puzzleLevels.js");

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

function levelDef(levelKey) {
  return (
    ALL_PUZZLE_LEVEL_DEFS.find((d) => d.levelKey === levelKey)
  );
}

test("config exposes puzzleWeekly when enabled", async () => {
  assert.equal(config.puzzleWeeklyEnabled, true);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.puzzleWeekly, true);
});

test("first entry free; retry after settle costs 10; insufficient funds clear error", async () => {
  const auth = await register(`pzfee${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[0];
  const bal0 = getJiuCoinBalance(auth.user.id);
  assert.equal(bal0, JIU_COIN_REGISTER_GRANT);

  const s1 = await startLevel(auth, def.levelKey, `fee-s1-${auth.user.id}`);
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  assert.equal(s1.json.data.createFee, 0);
  assert.equal(s1.json.data.charged, false);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0);

  const hold = Array.from({ length: def.gameDays - 1 }, () => "hold");
  const f1 = await finishLevel(auth, s1.json.data.game.gameId, hold);
  assert.equal(f1.status, 201, JSON.stringify(f1.json));

  const list = await api("/api/v1/puzzles");
  const lv = list.json.data.levels.find((l) => l.levelKey === def.levelKey);
  assert.equal(lv.entryFee, PUZZLE_RETRY_FEE);
  assert.equal(list.json.data.retryFee, PUZZLE_RETRY_FEE);

  openDb()
    .prepare(`UPDATE users SET jiu_coin_balance = 5, updated_at = datetime('now') WHERE id = ?`)
    .run(auth.user.id);
  assert.equal(getJiuCoinBalance(auth.user.id), 5);

  const s2 = await startLevel(auth, def.levelKey, `fee-s2-${auth.user.id}`);
  assert.equal(s2.status, 402, JSON.stringify(s2.json));
  assert.equal(s2.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(getJiuCoinBalance(auth.user.id), 5);

  openDb()
    .prepare(`UPDATE users SET jiu_coin_balance = 50, updated_at = datetime('now') WHERE id = ?`)
    .run(auth.user.id);
  const s3 = await startLevel(auth, def.levelKey, `fee-s3-${auth.user.id}`);
  assert.equal(s3.status, 201, JSON.stringify(s3.json));
  assert.equal(s3.json.data.charged, true);
  assert.equal(s3.json.data.createFee, PUZZLE_RETRY_FEE);
  assert.equal(getJiuCoinBalance(auth.user.id), 40);
});

test("3★ bonus once independent of 2★ first-clear", async () => {
  const auth = await register(`pz3s${Date.now().toString(36)}`);
  const def = CHAPTER1_LEVEL_DEFS[1];
  const bal0 = getJiuCoinBalance(auth.user.id);
  const s1 = await startLevel(auth, def.levelKey, `3s-1-${auth.user.id}`);
  const f1 = await finishLevel(auth, s1.json.data.game.gameId, def.validatedThreeStarActions);
  assert.equal(f1.status, 201, JSON.stringify(f1.json));
  assert.equal(f1.json.data.stars, 3);
  assert.equal(f1.json.data.reward.grantedThisTime, true);
  assert.equal(f1.json.data.reward.amount, PUZZLE_FIRST_CLEAR_REWARD);
  assert.equal(f1.json.data.threeStarReward.grantedThisTime, true);
  assert.equal(f1.json.data.threeStarReward.amount, PUZZLE_THREE_STAR_REWARD);
  assert.equal(
    getJiuCoinBalance(auth.user.id),
    bal0 + PUZZLE_FIRST_CLEAR_REWARD + PUZZLE_THREE_STAR_REWARD
  );
});

test("shanghai ISO week id stable Mon–Sun bounds", () => {
  const wed = new Date("2026-09-16T04:00:00.000Z");
  const wid = shanghaiIsoWeekId(wed);
  assert.match(wid, /^\d{4}-W\d{2}$/);
  const bounds = shanghaiIsoWeekBounds(wid);
  assert.equal(bounds.weekId, wid);
  assert.ok(Date.parse(bounds.startIso) < Date.parse(bounds.endIso));
  const [y, m, d] = bounds.startYmd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() || 7;
  assert.equal(dow, 1);
});

test("featured level deterministic; weekly flag-off isolated", async () => {
  seedAllPuzzleChapters();
  const weekId = shanghaiIsoWeekId(new Date("2026-09-16T04:00:00.000Z"));
  const a = featuredLevelKeyForWeek(weekId);
  const b = featuredLevelKeyForWeek(weekId);
  assert.equal(a, b);
  assert.ok(a && (a.startsWith("ch1-") || a.startsWith("ch2-")));

  const board = await api("/api/v1/puzzles/weekly/board");
  assert.equal(board.status, 200, JSON.stringify(board.json));
  assert.equal(board.json.data.ready, true);
  assert.equal(board.json.data.level.levelKey, shanghaiIsoWeekId() === weekId ? a : board.json.data.level.levelKey);

  const prev = config.puzzleWeeklyEnabled;
  config.puzzleWeeklyEnabled = false;
  try {
    const off = await api("/api/v1/puzzles/weekly");
    assert.equal(off.status, 404);
    assert.equal(off.json.error.code, "PUZZLE_WEEKLY_DISABLED");
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.json.data.features.puzzleWeekly, false);
  } finally {
    config.puzzleWeeklyEnabled = prev;
  }
});

test("weekly board ranks best returnPpm one row per user", async () => {
  seedAllPuzzleChapters();
  const weekId = shanghaiIsoWeekId();
  const levelKey = featuredLevelKeyForWeek(weekId);
  const def = levelDef(levelKey);
  assert.ok(def);

  async function playHold(auth, key) {
    const st = await startLevel(auth, levelKey, key);
    assert.equal(st.status, 201, JSON.stringify(st.json));
    const hold = Array.from({ length: def.gameDays - 1 }, () => "hold");
    const fin = await finishLevel(auth, st.json.data.game.gameId, hold);
    assert.equal(fin.status, 201, JSON.stringify(fin.json));
    return fin.json.data;
  }

  // Shared cookie jar: finish all of A before registering B.
  const authA = await register(`pzwka${Date.now().toString(36)}`);
  const a1 = await playHold(authA, `rank-a1-${authA.user.id}`);
  const a2 = await playHold(authA, `rank-a2-${authA.user.id}`);
  const userA = authA.user.id;

  const authB = await register(`pzwkb${Date.now().toString(36)}`);
  const b1 = await playHold(authB, `rank-b1-${authB.user.id}`);
  assert.ok(typeof a1.returnPpm === "number");
  assert.ok(typeof b1.returnPpm === "number");

  const board = await api(`/api/v1/puzzles/weekly/board?week=${encodeURIComponent(weekId)}`);
  assert.equal(board.status, 200, JSON.stringify(board.json));
  assert.equal(board.json.data.level.levelKey, levelKey);
  const ids = board.json.data.entries.map((e) => e.userId);
  assert.ok(ids.includes(userA));
  assert.ok(ids.includes(authB.user.id));
  assert.equal(ids.filter((id) => id === userA).length, 1);

  const board2 = getPuzzleWeeklyBoard({ weekId, limit: 50 });
  const aRows = board2.entries.filter((e) => e.userId === userA);
  assert.equal(aRows.length, 1);
  assert.equal(aRows[0].returnPpm, Math.max(a1.returnPpm, a2.returnPpm));
});
