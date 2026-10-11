import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { balanceOf, pvpLedger, seedUser } from "./fixture.js";

process.env.ADMIN_ENABLED = "1";
prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { hashPassword } = await import("../../src/lib/crypto.js");
const { roundHalfUp } = await import("../../../shared/engine.js");
const { acceptChallenge, createChallenge, declineChallenge, markReady } = await import("../../src/lib/pvp/challenges.js");
const { forfeitMatch } = await import("../../src/lib/pvp/match.js");
const { finishMatch } = await import("../../src/lib/pvp/settlement.js");
const { readDrain } = await import("../../src/lib/pvp/drain.js");
const { PVP_TOMBSTONE_TABLES } = await import("../../src/lib/pvp/accounts.js");
const { softDeleteUser } = await import("../../src/lib/users.js");
const { replayUserTombstones, writeUserTombstone } = await import("../../src/lib/tombstones.js");
const { createSession } = await import("../../src/lib/sessions.js");
const { startTestServer } = await import("../helpers.js");

config.pvpBattleEnabled = true;
migrate();
const http = await startTestServer();
const db = openDb();
let keyN = 0;

test.after(async () => {
  config.pvpBattleEnabled = true;
  await http.stop();
  closeDb();
});

function key(label) {
  keyN += 1;
  return `gov-${label}-${keyN}-0123456789abcdef`;
}

function user(label) {
  const name = `${label}-${crypto.randomUUID()}`;
  const id = seedUser(db, { name });
  return { id, name, session: createSession(id) };
}

function startMatch(label) {
  const a = user(`${label}-a`);
  const b = user(`${label}-b`);
  const now = Date.now();
  const created = createChallenge(db, { fromUserId: a.id, toUserId: b.id, createKey: key(label), now });
  assert.equal(created.ok, true, JSON.stringify(created));
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b.id, now });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(markReady(db, { matchId: accepted.matchId, userId: a.id, now: now + 1 }).waiting, true);
  const started = markReady(db, { matchId: accepted.matchId, userId: b.id, now: now + 2 });
  assert.equal(started.started, true, JSON.stringify(started));
  const snap = JSON.parse(db.prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(accepted.matchId).snapshot_json);
  return { a, b, matchId: accepted.matchId, stockCode: snap.stockCode, stockName: snap.stockName };
}

async function call(session, pathname, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { Accept: "application/json", Origin: "http://127.0.0.1" };
  if (session) {
    headers.Cookie = `${config.cookieName}=${session.sessionToken}`;
    if (method !== "GET") headers["X-CSRF-Token"] = session.csrfToken;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${http.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
}

function insertReport(reporterId, reportedId) {
  const now = Date.now();
  const challengeId = crypto.randomUUID();
  const matchId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pvp_challenges (
      id, from_user_id, to_user_id, pair_key, status, create_key, payload_hash, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'cancelled', ?, 'hash', ?, ?)`
  ).run(challengeId, reporterId, reportedId, `pair-${challengeId}`, key("stub"), now, now);
  db.prepare(
    `INSERT INTO pvp_matches (
      id, challenge_id, status, rule_version, pvp_version, rating_version, fill_mode,
      terminal_reason, created_at, finished_at
    ) VALUES (?, ?, 'aborted', 'sim30-mtm-v1', 'pvp-v1', 'pvp-elo-v1', 'next_open', 'ready_timeout', ?, ?)`
  ).run(matchId, challengeId, now, now);
  db.prepare(
    `INSERT INTO pvp_reports (
      match_id, reporter_id, reported_id, reason, detail, status, created_at
    ) VALUES (?, ?, ?, 'other', '', 'open', ?)`
  ).run(matchId, reporterId, reportedId, now);
}

test("stats, replay, blocks, reports, drain, abort, and deleted accounts", async () => {
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((row) => row.name);
  for (const table of PVP_TOMBSTONE_TABLES) assert.equal(names.includes(table), true, table);

  const quiet = user("quiet");
  const quietStats = await call(quiet.session, "/api/v1/me/pvp/stats");
  assert.equal(quietStats.status, 200);
  assert.equal(quietStats.json.data.empty, true);
  assert.equal(quietStats.json.data.winRate, null);
  assert.equal(JSON.stringify(quietStats.json.data).includes("completed_return_sum"), false);

  const abortedOnly = startMatch("aborted");
  const aborted = finishMatch(db, {
    matchId: abortedOnly.matchId,
    terminalType: "aborted",
    reason: "boot_recovery",
    now: Date.now(),
  });
  assert.equal(aborted.ok, true, JSON.stringify(aborted));
  const abortedStats = await call(abortedOnly.a.session, "/api/v1/me/pvp/stats");
  assert.equal(abortedStats.json.data.empty, true);
  assert.equal(abortedStats.json.data.winRate, null);
  const abortedList = await call(abortedOnly.a.session, "/api/v1/me/pvp/matches?limit=20");
  assert.equal(abortedList.json.data.entries.length, 1);

  const hero = user("hero");
  const beaten = user("beaten");
  const quitter = user("quitter");
  const drawn = user("drawn");
  const won = await (async () => {
    const now = Date.now();
    const created = createChallenge(db, { fromUserId: hero.id, toUserId: beaten.id, createKey: key("win"), now });
    assert.equal(created.ok, true, JSON.stringify(created));
    const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: beaten.id, now });
    const started = markReady(db, { matchId: accepted.matchId, userId: hero.id, now: now + 1 });
    assert.equal(started.waiting, true);
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: beaten.id, now: now + 2 }).started, true);
    const snap = JSON.parse(db.prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(accepted.matchId).snapshot_json);
    const done = finishMatch(db, {
      matchId: accepted.matchId,
      terminalType: "completed",
      reason: "unused",
      metrics: {
        [hero.id]: { returnPpm: 100000, mddPpm: 1000 },
        [beaten.id]: { returnPpm: 0, mddPpm: 2000 },
      },
      now: Date.now(),
    });
    assert.equal(done.reason, "completed_return");
    return { matchId: accepted.matchId, stockCode: snap.stockCode, stockName: snap.stockName };
  })();
  const lost = await (async () => {
    const now = Date.now();
    const created = createChallenge(db, { fromUserId: hero.id, toUserId: quitter.id, createKey: key("loss"), now });
    assert.equal(created.ok, true, JSON.stringify(created));
    const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: quitter.id, now });
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: hero.id, now: now + 1 }).waiting, true);
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: quitter.id, now: now + 2 }).started, true);
    const snap = JSON.parse(db.prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(accepted.matchId).snapshot_json);
    const forfeited = forfeitMatch(db, { matchId: accepted.matchId, userId: hero.id, commandKey: key("forfeit"), now: Date.now() });
    assert.equal(forfeited.ok, true, JSON.stringify(forfeited));
    return { matchId: accepted.matchId, stockCode: snap.stockCode, stockName: snap.stockName };
  })();
  const tied = await (async () => {
    const now = Date.now();
    const created = createChallenge(db, { fromUserId: hero.id, toUserId: drawn.id, createKey: key("draw"), now });
    assert.equal(created.ok, true, JSON.stringify(created));
    const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: drawn.id, now });
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: hero.id, now: now + 1 }).waiting, true);
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: drawn.id, now: now + 2 }).started, true);
    const done = finishMatch(db, {
      matchId: accepted.matchId,
      terminalType: "completed",
      reason: "unused",
      metrics: {
        [hero.id]: { returnPpm: 10, mddPpm: 5 },
        [drawn.id]: { returnPpm: 10, mddPpm: 5 },
      },
      now: Date.now(),
    });
    assert.equal(done.reason, "completed_draw");
    return { matchId: accepted.matchId };
  })();

  const stats = await call(hero.session, "/api/v1/me/pvp/stats");
  assert.equal(stats.status, 200);
  const body = stats.json.data;
  assert.equal(body.empty, false);
  assert.equal(body.wins, 1);
  assert.equal(body.losses, 1);
  assert.equal(body.draws, 1);
  assert.equal(body.winRate, roundHalfUp((1 / 3) * 1e6) / 1e6);
  assert.deepEqual(body.recent, ["draw", "loss", "win"]);
  assert.equal(body.completedGames, 2);
  assert.equal(body.meanCompletedReturnPpm, roundHalfUp((100000 + 10) / 2));
  assert.equal(body.bestCompletedReturnPpm, 100000);
  assert.equal(body.recentForfeits, 1);
  assert.equal(body.title.inPlacement, true);
  assert.equal(/\d+级/.test(JSON.stringify(body)), false);
  assert.equal(JSON.stringify(body).includes("再赢"), false);
  assert.equal(JSON.stringify(body).includes("completed_return_sum"), false);
  assert.equal(JSON.stringify(body).includes("累计"), false);

  const zero = await call(beaten.session, "/api/v1/me/pvp/stats");
  assert.equal(zero.json.data.empty, false);
  assert.equal(zero.json.data.winRate, 0);
  assert.equal(zero.json.data.losses, 1);

  config.pvpBattleEnabled = false;
  const closedStats = await call(hero.session, "/api/v1/me/pvp/stats");
  assert.equal(closedStats.status, 200);
  assert.equal(closedStats.json.data.winRate, body.winRate);
  const closedLobby = await call(null, "/api/v1/pvp/lobby/summary");
  assert.equal(closedLobby.json.data.disabledReason, "对战未开放");
  config.pvpBattleEnabled = true;

  const publicStats = await call(hero.session, `/api/v1/users/${hero.id}/pvp/stats`);
  assert.equal(publicStats.status, 404);

  const beforeCoins = balanceOf(db, hero.id);
  const beforeRating = db.prepare(`SELECT rating, games FROM pvp_ratings WHERE user_id = ?`).get(hero.id);
  const beforeReturn = db.prepare(`SELECT return_ppm, coin_delta FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(won.matchId, hero.id);
  const stranger = user("stranger");
  const hidden = await call(stranger.session, `/api/v1/pvp/matches/${won.matchId}`);
  assert.equal(hidden.status, 404);
  const extra = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "cheat", detail: "看见了", reportedId: stranger.id },
    idempotencyKey: key("extra-field"),
  });
  assert.equal(extra.status, 400);
  const reportKey = key("report");
  const filed = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "cheat", detail: "看见了" },
    idempotencyKey: reportKey,
  });
  assert.equal(filed.status, 200, JSON.stringify(filed.json));
  assert.equal(filed.json.data.reason, "cheat");
  assert.equal(filed.json.data.reportedId, beaten.id);
  const replayed = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "cheat", detail: "看见了" },
    idempotencyKey: reportKey,
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.json.data.id, filed.json.data.id);
  const conflict = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "nickname", detail: "看见了" },
    idempotencyKey: reportKey,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "IDEMPOTENCY_CONFLICT");
  const changed = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "other", detail: "另一句" },
    idempotencyKey: key("other-report"),
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.error.code, "REPORT_EXISTS");
  assert.equal(balanceOf(db, hero.id), beforeCoins);
  assert.deepEqual(db.prepare(`SELECT rating, games FROM pvp_ratings WHERE user_id = ?`).get(hero.id), beforeRating);
  assert.deepEqual(
    db.prepare(`SELECT return_ppm, coin_delta FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(won.matchId, hero.id),
    beforeReturn
  );

  const wonView = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}`);
  assert.equal(wonView.status, 200);
  assert.equal(wonView.json.data.replay.status, "failed");
  assert.equal(wonView.json.data.me.returnPpm, 100000);
  assert.equal(wonView.json.data.identity.stockCode, won.stockCode);
  assert.equal(JSON.stringify(wonView.json.data.replay).includes(won.stockCode), false);
  assert.deepEqual(
    db.prepare(`SELECT return_ppm, coin_delta FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(won.matchId, hero.id),
    beforeReturn
  );
  assert.equal(
    db.prepare(`SELECT analysis_status FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(won.matchId, hero.id).analysis_status,
    "failed"
  );

  const lostView = await call(hero.session, `/api/v1/pvp/matches/${lost.matchId}`);
  assert.equal(lostView.json.data.replay.status, "ready");
  assert.equal(lostView.json.data.replay.buyHoldPpm, null);
  assert.equal(lostView.json.data.identity, undefined);
  assert.equal(JSON.stringify(lostView.json.data).includes(lost.stockCode), false);
  assert.equal(JSON.stringify(lostView.json.data).includes(lost.stockName), false);
  const lostCoins = db.prepare(`SELECT return_ppm, coin_delta FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(lost.matchId, hero.id);
  await call(hero.session, `/api/v1/pvp/matches/${lost.matchId}`);
  assert.deepEqual(
    db.prepare(`SELECT return_ppm, coin_delta FROM pvp_match_players WHERE match_id = ? AND user_id = ?`).get(lost.matchId, hero.id),
    lostCoins
  );

  for (let i = 0; i < 9; i += 1) insertReport(hero.id, beaten.id);
  const capped = await call(hero.session, `/api/v1/pvp/matches/${tied.matchId}/report`, {
    method: "POST",
    body: { reason: "grief_forfeit", detail: "" },
    idempotencyKey: key("capped"),
  });
  assert.equal(capped.status, 429);
  assert.equal(capped.json.error.message, "今日举报次数已用完");
  const stillThere = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}/report`, {
    method: "POST",
    body: { reason: "cheat", detail: "看见了" },
    idempotencyKey: key("replay-after-cap"),
  });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.json.data.id, filed.json.data.id);

  const openMatch = startMatch("open-report");
  const tooSoon = await call(openMatch.a.session, `/api/v1/pvp/matches/${openMatch.matchId}/report`, {
    method: "POST",
    body: { reason: "cheat", detail: "" },
    idempotencyKey: key("soon"),
  });
  assert.equal(tooSoon.status, 409);
  assert.equal(tooSoon.json.error.code, "MATCH_OPEN");
  finishMatch(db, { matchId: openMatch.matchId, terminalType: "aborted", reason: "boot_recovery", now: Date.now() });

  const selfBlock = await call(hero.session, "/api/v1/pvp/blocks", {
    method: "POST",
    body: { userId: hero.id },
    idempotencyKey: key("self"),
  });
  assert.equal(selfBlock.status, 422);
  const missing = await call(hero.session, "/api/v1/pvp/blocks", {
    method: "POST",
    body: { userId: 999999999 },
    idempotencyKey: key("missing"),
  });
  assert.equal(missing.status, 404);
  const absent = await call(hero.session, "/api/v1/pvp/blocks/999999999", { method: "DELETE" });
  assert.equal(absent.status, 204);

  const blockedMatch = startMatch("block");
  const charged = balanceOf(db, blockedMatch.a.id);
  const blockKey = key("block");
  const blocked = await call(blockedMatch.a.session, "/api/v1/pvp/blocks", {
    method: "POST",
    body: { userId: blockedMatch.b.id },
    idempotencyKey: blockKey,
  });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.json));
  assert.equal(balanceOf(db, blockedMatch.a.id), charged);
  assert.equal(balanceOf(db, blockedMatch.b.id), charged);
  assert.equal(db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(blockedMatch.matchId).status, "playing");
  const blockAgain = await call(blockedMatch.a.session, "/api/v1/pvp/blocks", {
    method: "POST",
    body: { userId: blockedMatch.b.id },
    idempotencyKey: blockKey,
  });
  assert.equal(blockAgain.status, 200);

  const readyPair = user("ready-a");
  const readyOther = user("ready-b");
  const now = Date.now();
  const pendingReady = createChallenge(db, { fromUserId: readyPair.id, toUserId: readyOther.id, createKey: key("ready"), now });
  const acceptedReady = acceptChallenge(db, { challengeId: pendingReady.challenge.id, userId: readyOther.id, now });
  assert.equal(db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(acceptedReady.matchId).status, "waiting_ready");
  softDeleteUser(readyPair.id, { source: "self" });
  const closedReady = db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(acceptedReady.matchId);
  assert.equal(closedReady.status, "aborted");
  assert.equal(closedReady.terminal_reason, "account_unavailable");
  assert.equal(balanceOf(db, readyPair.id), 500);
  assert.equal(pvpLedger(db, acceptedReady.matchId).length, 0);

  const live = startMatch("tomb");
  const ledgerBefore = pvpLedger(db, live.matchId);
  assert.equal(ledgerBefore.filter((row) => row.reason === "pvp_entry").length, 2);
  const tombUser = db.prepare(`SELECT username_normalized FROM users WHERE id = ?`).get(live.a.id);
  writeUserTombstone({ userId: live.a.id, usernameNormalized: tombUser.username_normalized, source: "self" });
  assert.equal(db.prepare(`SELECT status FROM users WHERE id = ?`).get(live.a.id).status, "active");
  const replayedTomb = replayUserTombstones();
  assert.equal(replayedTomb.applied >= 1, true);
  assert.equal(db.prepare(`SELECT status FROM users WHERE id = ?`).get(live.a.id).status, "deleted");
  const tombMatch = db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(live.matchId);
  assert.equal(tombMatch.status, "settled");
  assert.equal(tombMatch.terminal_reason, "account_unavailable");
  assert.equal(balanceOf(db, live.b.id), 515);
  assert.equal(balanceOf(db, live.a.id), 480);
  const ledgerAfter = pvpLedger(db, live.matchId);
  assert.equal(ledgerAfter.filter((row) => row.reason === "pvp_entry").length, 2);
  assert.equal(ledgerAfter.some((row) => row.reason === "pvp_reward"), true);

  softDeleteUser(beaten.id, { source: "self" });
  db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(drawn.id);
  const history = await call(hero.session, "/api/v1/me/pvp/matches?limit=20");
  const beatenRow = history.json.data.entries.find((entry) => entry.opponentUserId === beaten.id);
  const drawnRow = history.json.data.entries.find((entry) => entry.opponentUserId === drawn.id);
  assert.equal(beatenRow.opponentNickname, "已注销用户");
  assert.equal(drawnRow.opponentNickname, drawn.name);
  const deletedView = await call(hero.session, `/api/v1/pvp/matches/${won.matchId}`);
  assert.equal(deletedView.json.data.opponent.nickname, "已注销用户");
  const blockedDeleted = await call(hero.session, "/api/v1/pvp/blocks", {
    method: "POST",
    body: { userId: beaten.id },
    idempotencyKey: key("deleted-block"),
  });
  assert.equal(blockedDeleted.status, 200, JSON.stringify(blockedDeleted.json));

  const admin = user("admin");
  const password = "admin-pass-1";
  db.prepare(`UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?`).run(await hashPassword(password), admin.id);
  const outsider = await call(hero.session, "/api/v1/admin/pvp/overview");
  assert.equal(outsider.status, 403);
  const overview = await call(admin.session, "/api/v1/admin/pvp/overview");
  assert.equal(overview.status, 200);
  const unproven = await call(admin.session, "/api/v1/admin/pvp/drain", {
    method: "POST",
    body: { drain: true, reason: "停止接新局" },
    idempotencyKey: key("drain-early"),
  });
  assert.equal(unproven.status, 403);
  assert.equal(unproven.json.error.code, "ADMIN_REAUTH_REQUIRED");
  const reauth = await call(admin.session, "/api/v1/admin/reauth", {
    method: "POST",
    body: { password },
  });
  assert.equal(reauth.status, 200, JSON.stringify(reauth.json));

  const caller = user("caller");
  const callee = user("callee");
  const invite = createChallenge(db, { fromUserId: caller.id, toUserId: callee.id, createKey: key("invite"), now: Date.now() });
  assert.equal(invite.ok, true, JSON.stringify(invite));
  const present = await call(callee.session, "/api/v1/pvp/lobby/presence", {
    method: "POST",
    body: { available: true },
  });
  assert.equal(present.status, 200);

  const forbidden = await call(admin.session, "/api/v1/admin/pvp/drain", {
    method: "POST",
    body: { drain: true, reason: "停止接新局", returnPpm: 1 },
    idempotencyKey: key("drain-bad"),
  });
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.json.error.message, "不能修改收益或流水");
  const draining = await call(admin.session, "/api/v1/admin/pvp/drain", {
    method: "POST",
    body: { drain: true, reason: "停止接新局" },
    idempotencyKey: key("drain"),
  });
  assert.equal(draining.status, 200, JSON.stringify(draining.json));
  assert.equal(draining.json.data.draining, true);
  const stored = db.prepare(`SELECT value_json FROM pvp_runtime_control WHERE key = 'drain'`).get();
  assert.equal(JSON.parse(stored.value_json).draining, true);
  assert.equal(readDrain(db), true);
  db.prepare(`UPDATE pvp_runtime_control SET value_json = ? WHERE key = 'drain'`).run("{");
  assert.equal(readDrain(db), true);
  const summary = await call(null, "/api/v1/pvp/lobby/summary");
  assert.equal(summary.json.data.acceptingNew, false);
  assert.equal(summary.json.data.disabledReason, "对战已停止接受新局");
  const refused = await call(caller.session, "/api/v1/pvp/challenges", {
    method: "POST",
    body: { toUserId: callee.id },
    idempotencyKey: key("while-draining"),
  });
  assert.equal(refused.status, 503);
  assert.equal(refused.json.error.code, "DRAINING");
  const declined = await call(callee.session, `/api/v1/pvp/challenges/${invite.challenge.id}/respond`, {
    method: "POST",
    body: { accept: false },
  });
  assert.equal(declined.status, 200, JSON.stringify(declined.json));
  assert.equal(declined.json.data.status, "declined");

  const auditBefore = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'pvp.abort_active'`).get().c;
  const preview = await call(admin.session, "/api/v1/admin/pvp/abort-active", {
    method: "POST",
    body: {},
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.data.confirmRequired, true);
  assert.equal(preview.json.data.playing >= 1, true);
  assert.equal(preview.json.data.refundHeadcount >= 2, true);
  assert.equal(db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(blockedMatch.matchId).status, "playing");
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'pvp.abort_active'`).get().c, auditBefore);
  const rewritten = await call(admin.session, "/api/v1/admin/pvp/abort-active", {
    method: "POST",
    body: { confirm: true, reason: "结束测试对局", return_ppm: 0 },
    idempotencyKey: key("abort-bad"),
  });
  assert.equal(rewritten.status, 400);
  assert.equal(db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(blockedMatch.matchId).status, "playing");
  const abortKey = key("abort");
  const confirmed = await call(admin.session, "/api/v1/admin/pvp/abort-active", {
    method: "POST",
    body: { confirm: true, reason: "结束测试对局" },
    idempotencyKey: abortKey,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.equal(confirmed.json.data.confirmRequired, false);
  assert.equal(db.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(blockedMatch.matchId).terminal_reason, "admin_abort");
  assert.equal(balanceOf(db, blockedMatch.a.id), 500);
  assert.equal(balanceOf(db, blockedMatch.b.id), 500);
  assert.equal(pvpLedger(db, blockedMatch.matchId).filter((row) => row.reason === "pvp_refund").length, 2);
  const againAbort = await call(admin.session, "/api/v1/admin/pvp/abort-active", {
    method: "POST",
    body: { confirm: true, reason: "结束测试对局" },
    idempotencyKey: abortKey,
  });
  assert.equal(againAbort.status, 200);
  assert.equal(pvpLedger(db, blockedMatch.matchId).filter((row) => row.reason === "pvp_refund").length, 2);
  const undrain = await call(admin.session, "/api/v1/admin/pvp/drain", {
    method: "POST",
    body: { drain: false, reason: "恢复接新局" },
    idempotencyKey: key("undrain"),
  });
  assert.equal(undrain.status, 200, JSON.stringify(undrain.json));
  assert.equal(readDrain(db), false);
  const actions = db.prepare(`SELECT action FROM audit_logs WHERE actor_id = ? AND action LIKE 'pvp.%' ORDER BY id`).all(admin.id).map((row) => row.action);
  assert.equal(actions.includes("pvp.drain"), true);
  assert.equal(actions.includes("pvp.undrain"), true);
  assert.equal(actions.includes("pvp.abort_active"), true);
});
