import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

// Legacy batch protocol (no EVENT_PROTOCOL): the path that used to store stake games as assist_class 'legacy'.
prepareTestEnv();
process.env.COIN_STAKE_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1"; // the board then defaults to the 纯净 class
delete process.env.EVENT_PROTOCOL_ENABLED;

const { openDb } = await import("../src/db/connection.js");
const { forceResultRanking } = await import("../src/lib/leaderboard.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;
test.after(async () => {
  await stop();
});

let seq = 0;
const key = (p) => `${p}-${Date.now()}-${++seq}`;
const pick = () => ({ stockIndex: 0, windowStartIndex: 30, historyLength: 30 });

async function optIn(auth) {
  const r = await api("/api/v1/me", { method: "PATCH", csrf: auth.csrfToken, body: { leaderboardOptIn: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
async function play(auth, { stake = null, fillMode = "next_open" } = {}) {
  const body = stake ? { fillMode, gameKind: "stake", stake, pick: pick() } : { fillMode, pick: pick() };
  const c = await api("/api/v1/games", { method: "POST", csrf: auth.csrfToken, headers: { "Idempotency-Key": key("c") }, body });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const gameId = c.json.data.gameId;
  const f = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(["buy", "sell", ...holds(27)]), finish: true },
  });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  return gameId;
}
const sess = (id) => openDb().prepare("SELECT game_kind, assist_class FROM game_sessions WHERE id = ?").get(id);
const res = (id) => openDb().prepare("SELECT assist_class FROM game_results WHERE game_id = ?").get(id);
/** Production runs the event protocol, where a plain classic game is 纯净 from the start; this file runs the legacy path. */
const asProductionClassic = (id) => openDb().prepare("UPDATE game_sessions SET assist_class = 'clean' WHERE id = ?").run(id);

test("a finished 韭币局 is a 纯净 game and appears on the 龙虎榜 with its return", async () => {
  const auth = await register(`sb${Date.now().toString(36)}`);
  await optIn(auth);
  const id = await play(auth, { stake: 50 });
  assert.deepEqual(sess(id), { game_kind: "stake", assist_class: "clean" });
  assert.ok([null, "clean"].includes(res(id).assist_class), "a result row, when it carries the class, says clean");
  forceResultRanking(id, { returnPpm: 777000, finishedAt: "2026-09-10T08:00:00.000Z" });
  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  assert.equal(board.status, 200, JSON.stringify(board.json));
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 777000), "stake return is on the board");
  assert.ok(Number.isInteger(board.json.data.myRank), "the player sees their own rank");
});

test("one seat per player: a stake game and a classic game compete for the same row (best wins)", async () => {
  const auth = await register(`sc${Date.now().toString(36)}`);
  await optIn(auth);
  const classic = await play(auth);
  asProductionClassic(classic);
  forceResultRanking(classic, { returnPpm: 410000, finishedAt: "2026-09-11T08:00:00.000Z" });
  const stake = await play(auth, { stake: 20 });
  forceResultRanking(stake, { returnPpm: 650000, finishedAt: "2026-09-11T09:00:00.000Z" });
  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  const rows = board.json.data.top10.filter((r) => [410000, 650000].includes(r.returnPpm));
  assert.equal(rows.length, 1, "one row for this player");
  assert.equal(rows[0].returnPpm, 650000, "the better of the two games, whichever kind it was");
  // the average board counts both
  const avg = await api("/api/v1/leaderboard?fillMode=next_open&metric=average");
  assert.equal(avg.status, 200, JSON.stringify(avg.json));
});

test("my recent games and /me/stats include 韭币局 games", async () => {
  const auth = await register(`sd${Date.now().toString(36)}`);
  await optIn(auth);
  const classic = await play(auth);
  asProductionClassic(classic);
  const stake = await play(auth, { stake: 30 });
  const board = await api("/api/v1/leaderboard?fillMode=next_open");
  const recent = board.json.data.myRecent || [];
  const byId = Object.fromEntries(recent.map((g) => [g.gameId, g]));
  assert.ok(byId[classic] && byId[stake], JSON.stringify(Object.keys(board.json.data)));
  assert.equal(byId[stake].status, "counted", "a 韭币局 is a counted game, not 'other board'");
  assert.equal(byId[stake].assistClass, "clean");
  const stats = await api("/api/v1/me/stats?fillMode=next_open");
  assert.equal(stats.status, 200, JSON.stringify(stats.json));
  assert.equal(stats.json.data.count, 2);
});

test("oneshot / survival / daily stay off the classic board; their own boards are unchanged", async () => {
  const kinds = openDb().prepare("SELECT DISTINCT game_kind FROM game_sessions").all().map((r) => r.game_kind);
  assert.ok(kinds.includes("stake"));
  const bad = await api("/api/v1/leaderboard?gameKind=stake");
  assert.equal(bad.status, 400, "the board is not addressable as its own kind: stake rides the classic board");
});

test("migration 039 backfills old 'legacy' stake rows (and leaves other kinds alone)", async () => {
  const db = openDb();
  const auth = await register(`se${Date.now().toString(36)}`);
  const id = await play(auth, { stake: 40 });
  const other = await play(auth);
  db.prepare("UPDATE game_sessions SET assist_class='legacy' WHERE id IN (?, ?)").run(id, other);
  db.prepare("UPDATE game_results SET assist_class='legacy' WHERE game_id IN (?, ?)").run(id, other);
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../migrations/039_stake_on_leaderboard.sql", import.meta.url), "utf8");
  db.exec(sql);
  assert.equal(sess(id).assist_class, "clean");
  assert.equal(res(id).assist_class, "clean");
  assert.equal(sess(other).assist_class, "legacy", "a non-stake row is not touched by this migration");
});
