import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.DAILY_CHALLENGE_ENABLED = "1";
// Fixed Shanghai morning so opens/closes are deterministic for most cases.
process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-09-11T04:00:00.000Z")); // 12:00 Shanghai

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT, JIU_COIN_GAME_CREATE_COST } =
  await import("../src/lib/jiuCoin.js");
const {
  seedNearDailyChallenges,
  shanghaiYmdAt,
  challengeNow,
  getChallengeByDate,
  DAILY_CHALLENGE_COST,
} = await import("../src/lib/dailyChallenge.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

async function startDaily(auth, key = `daily-key-${Math.random().toString(36).slice(2)}`) {
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

test("config exposes dailyChallenge when enabled", async () => {
  assert.equal(config.dailyChallengeEnabled, true);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.dailyChallenge, true);
});

test("seed publishes >=14 near-term challenges; two users same snapshot", async () => {
  const seeded = seedNearDailyChallenges(challengeNow());
  assert.ok(seeded.created >= 0);
  const n = openDb().prepare(`SELECT COUNT(*) AS c FROM daily_challenges`).get().c;
  assert.ok(n >= 14, `expected >=14 challenges, got ${n}`);

  const aCreds = { username: `dca${Date.now().toString(36)}`, password: "pass1234" };
  const a = await register(aCreds.username, aCreds.password);
  const sa = await startDaily(a, `same-snap-a-${a.user.id}`);
  assert.equal(sa.status, 201, JSON.stringify(sa.json));

  const b = await register(`dcb${Date.now().toString(36)}`);
  const sb = await startDaily(b, `same-snap-b-${b.user.id}`);
  assert.equal(sb.status, 201, JSON.stringify(sb.json));
  const ga = sa.json.data.game;
  const gb = sb.json.data.game;
  assert.equal(ga.stockIndex, gb.stockIndex);
  assert.equal(ga.windowStartIndex, gb.windowStartIndex);
  assert.equal(ga.challengeId, gb.challengeId);
  assert.equal(ga.gameKind, "daily");
  assert.equal(ga.fillMode, "next_open");
  assert.equal(ga.protocolVersion, "legacy-batch");
});

test("double-create same day: one charge and one chance; resume no charge", async () => {
  const auth = await register(`dcd${Date.now().toString(36)}`);
  const bal0 = getJiuCoinBalance(auth.user.id);
  assert.equal(bal0, JIU_COIN_REGISTER_GRANT);

  const key = `idem-daily-${auth.user.id}`;
  const first = await startDaily(auth, key);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.data.charged, true);
  assert.equal(DAILY_CHALLENGE_COST, 50);
  assert.notEqual(DAILY_CHALLENGE_COST, JIU_COIN_GAME_CREATE_COST);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - DAILY_CHALLENGE_COST);

  const again = await startDaily(auth, key);
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.data.resumed, true);
  assert.equal(again.json.data.charged, false);
  assert.equal(again.json.data.game.gameId, first.json.data.game.gameId);
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - DAILY_CHALLENGE_COST);

  const otherKey = await startDaily(auth, `other-${auth.user.id}`);
  assert.ok([200, 201].includes(otherKey.status) || otherKey.status === 409);
  // Existing attempt with active game → resume without new charge
  if (otherKey.status === 200) {
    assert.equal(otherKey.json.data.charged, false);
  }
  assert.equal(getJiuCoinBalance(auth.user.id), bal0 - DAILY_CHALLENGE_COST);

  const st = await api("/api/v1/daily-challenge");
  assert.equal(st.status, 200);
  assert.equal(st.json.data.remainingChance, 0);
  assert.ok(st.json.data.activeGame?.gameId);
});

test("insufficient balance thresholds: 0 and cost-1 fail; cost succeeds", async () => {
  const ymd = shanghaiYmdAt(challengeNow());
  const ch = getChallengeByDate(ymd);
  assert.ok(ch);

  async function assertNoAttempt(userId) {
    const att = openDb()
      .prepare(`SELECT * FROM daily_challenge_attempts WHERE user_id = ? AND challenge_id = ?`)
      .get(userId, ch.id);
    assert.equal(att, undefined);
  }

  const poor0 = await register(`dci0${Date.now().toString(36)}`);
  openDb().prepare(`UPDATE users SET jiu_coin_balance = 0 WHERE id = ?`).run(poor0.user.id);
  const r0 = await startDaily(poor0, `poor0-${poor0.user.id}`);
  assert.equal(r0.status, 402);
  assert.equal(r0.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(r0.json.error.details.required, DAILY_CHALLENGE_COST);
  await assertNoAttempt(poor0.user.id);
  assert.equal(getJiuCoinBalance(poor0.user.id), 0);

  const poor49 = await register(`dci49${Date.now().toString(36)}`);
  openDb()
    .prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`)
    .run(DAILY_CHALLENGE_COST - 1, poor49.user.id);
  const r49 = await startDaily(poor49, `poor49-${poor49.user.id}`);
  assert.equal(r49.status, 402);
  assert.equal(r49.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(r49.json.error.details.required, DAILY_CHALLENGE_COST);
  assert.equal(r49.json.error.details.balance, DAILY_CHALLENGE_COST - 1);
  await assertNoAttempt(poor49.user.id);
  assert.equal(getJiuCoinBalance(poor49.user.id), DAILY_CHALLENGE_COST - 1);

  const ok50 = await register(`dci50${Date.now().toString(36)}`);
  openDb()
    .prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`)
    .run(DAILY_CHALLENGE_COST, ok50.user.id);
  const r50 = await startDaily(ok50, `ok50-${ok50.user.id}`);
  assert.equal(r50.status, 201, JSON.stringify(r50.json));
  assert.equal(r50.json.data.charged, true);
  assert.equal(getJiuCoinBalance(ok50.user.id), 0);
});

test("settle before cutoff enters board; late settle excluded; idempotent retry", async () => {
  const auth = await register(`dcs${Date.now().toString(36)}`);
  const started = await startDaily(auth, `settle-${auth.user.id}`);
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const gameId = started.json.data.game.gameId;

  const fin = await finishHold(auth, gameId);
  assert.ok([200, 201].includes(fin.status), JSON.stringify(fin.json));
  assert.ok(fin.json.data.mddPpm != null);
  assert.ok(fin.json.data.benchmarkReturnPpm != null);

  const retry = await finishHold(auth, gameId);
  assert.equal(retry.status, 200);
  assert.equal(retry.json.data.returnPpm, fin.json.data.returnPpm);

  const board = await api("/api/v1/daily-challenge/leaderboard");
  assert.equal(board.status, 200);
  assert.equal(board.json.data.ready, true);
  assert.ok(board.json.data.total >= 1);
  const mine = board.json.data.entries.find((e) => e.userId === auth.user.id);
  assert.ok(mine, "should be on board before cutoff");
  // Pre-cutoff redaction: no stock identity on entries
  assert.equal(mine.stockCode, undefined);

  // Late settle path: create another user after moving clock past closesAt
  const auth2 = await register(`dcl${Date.now().toString(36)}`);
  const ymd = shanghaiYmdAt(challengeNow());
  const ch = getChallengeByDate(ymd);
  const closesAtMs = Date.parse(ch.closes_at);
  process.env.STOCKGAME_NOW_MS = String(closesAtMs - 60_000);
  const lateStart = await startDaily(auth2, `late-start-${auth2.user.id}`);
  assert.equal(lateStart.status, 201, JSON.stringify(lateStart.json));
  const lateGameId = lateStart.json.data.game.gameId;
  process.env.STOCKGAME_NOW_MS = String(closesAtMs + 5_000);
  const lateFin = await finishHold(auth2, lateGameId);
  assert.ok([200, 201].includes(lateFin.status), JSON.stringify(lateFin.json));
  const att = openDb()
    .prepare(`SELECT * FROM daily_challenge_attempts WHERE game_id = ?`)
    .get(lateGameId);
  assert.equal(att.status, "settle_late");
  assert.equal(att.board_eligible, 0);

  // restore clock for remaining tests
  process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-09-11T04:00:00.000Z"));
});

test("flag off returns 404", async () => {
  config.dailyChallengeEnabled = false;
  const r = await api("/api/v1/daily-challenge");
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, "DAILY_CHALLENGE_DISABLED");
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.dailyChallenge, false);
  config.dailyChallengeEnabled = true;
});

test("daily board entries include avatar fields in one payload", async () => {
  const auth = await register(`dcav${Date.now().toString(36)}`);
  const started = await startDaily(auth, `avatar-${auth.user.id}`);
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const fin = await finishHold(auth, started.json.data.game.gameId);
  assert.ok([200, 201].includes(fin.status), JSON.stringify(fin.json));
  const board = await api("/api/v1/daily-challenge/leaderboard");
  assert.equal(board.status, 200);
  const mine = board.json.data.entries.find((e) => e.userId === auth.user.id);
  assert.ok(mine, "should be on board");
  assert.ok("avatarId" in mine);
  assert.ok("avatarUrl" in mine);
  assert.ok("avatarCustomPath" in mine);
  // No N+1: fields ride the list response (null URL falls back to preset on client).
  assert.equal(mine.avatarUrl, null);
});

test("daily game cannot rewind (kind/protocol unsupported)", async () => {
  const { config: cfg } = await import("../src/lib/config.js");
  cfg.gameRewindEnabled = true;

  const auth = await register(`dcrw${Date.now().toString(36)}`);
  const started = await startDaily(auth, `rewind-${auth.user.id}`);
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const gameId = started.json.data.game.gameId;
  assert.equal(started.json.data.game.gameKind, "daily");
  assert.equal(started.json.data.game.protocolVersion, "legacy-batch");

  const rw = await api(`/api/v1/games/${gameId}/rewind`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": `rw-daily-${gameId}` },
    body: { expectedRevision: started.json.data.game.revision ?? 0 },
  });
  assert.ok(rw.status >= 400, JSON.stringify(rw.json));
  const code = rw.json?.error?.code;
  assert.ok(
    code === "GAME_KIND_UNSUPPORTED" || code === "PROTOCOL_UNSUPPORTED",
    `expected kind/protocol reject, got ${code}: ${JSON.stringify(rw.json)}`
  );
});
