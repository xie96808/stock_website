import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "mini_intraday.jsonl");
const PHASE = Date.parse("2026-09-25T21:00:00+08:00");
const LONG_PHASE = Date.parse("2026-09-25T21:05:00+08:00");
const DAY = "2026-09-25";
const SCORE = "intraday-t0-mtm-v1";
const BANNED = new Set([
  "symbol", "name", "sessionDate", "bars_json", "window", "sharesNum", "sharesDen", "amountFen",
]);

prepareTestEnv();
process.env.INTRADAY_MODE_ENABLED = "1";
process.env.DAILY_CHALLENGE_ENABLED = "1";
process.env.GHOST_DUEL_ENABLED = "1";
process.env.PUZZLE_CHAPTER_ENABLED = "1";
process.env.STOCKGAME_INTRADAY_PATH = FIXTURE;
process.env.STOCKGAME_NOW_MS = String(Date.parse("2026-09-25T12:00:00.000Z"));

const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT, JIU_COIN_INTRADAY_RANKED_COST, JIU_COIN_INTRADAY_PRACTICE_COST } = await import("../src/lib/jiuCoin.js");
const { insertValidatedTape, intradayLibraryStatus } = await import("../src/lib/intradayPack.js");
const { limitPctForSymbol } = await import("../../shared/intradayTape.js");
const {
  pickChallengeTape,
  seedNearIntradayChallenges,
  ensureIntradayChallenge,
} = await import("../src/lib/intraday.js");
const { migrate } = await import("../src/db/migrate.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

function assertWhitelist(value, at = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertWhitelist(item, `${at}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    assert.equal(BANNED.has(key), false, `${at}.${key}`);
    if (key === "bars" || key === "fillBar") {
      const rows = key === "fillBar" ? [value[key]] : value[key];
      for (const bar of rows) {
        if (!bar) continue;
        assert.equal(bar.amountFen, undefined);
        assert.ok(Number.isInteger(bar.i));
      }
    }
    assertWhitelist(value[key], `${at}.${key}`);
  }
}

function setNow(ms) {
  process.env.STOCKGAME_NOW_MS = String(ms);
}

function ensureKey(key) {
  return key.length >= 8 ? key : `intraday-${key}`;
}

async function postSession(auth, body, key) {
  return api("/api/v1/intraday/sessions", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": ensureKey(key) },
    body,
  });
}

async function advance(auth, sessionId, body, key) {
  return api(`/api/v1/intraday/sessions/${sessionId}/advance`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": ensureKey(key) },
    body,
  });
}

async function finish(auth, sessionId, body, key) {
  return api(`/api/v1/intraday/sessions/${sessionId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": ensureKey(key) },
    body,
  });
}

async function abandon(auth, sessionId) {
  return api(`/api/v1/intraday/sessions/${sessionId}/abandon`, {
    method: "POST",
    csrf: auth.csrfToken,
  });
}

function resultCount(sessionId) {
  return openDb().prepare(`SELECT COUNT(*) AS c FROM intraday_results WHERE session_id = ?`).get(sessionId).c;
}

function fillLibrary() {
  const db = openDb();
  const line = fs.readFileSync(FIXTURE, "utf8").split(/\r?\n/).find((row) => row.trim());
  const base = JSON.parse(line);
  const symbols = ["600001", "600002", "600003", "600004", "600005", "600006"];
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11"];
  for (const symbol of symbols) {
    for (const sessionDate of dates) {
      const copy = JSON.parse(JSON.stringify(base));
      copy.symbol = symbol;
      copy.sessionDate = sessionDate;
      copy.limitPct = limitPctForSymbol(symbol);
      const inserted = insertValidatedTape(db, copy);
      if (!inserted.ok) throw new Error(`tape ${symbol} ${sessionDate} ${inserted.reason}`);
    }
  }
  return intradayLibraryStatus(db);
}

test("intraday flag on", async (t) => {
  await t.test("library not ready: GET 200 ready false, POST 503 does not charge", async () => {
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.json.data.features.intradayMode, true);
    const status = await api("/api/v1/intraday");
    assert.equal(status.status, 200, JSON.stringify(status.json));
    assert.equal(status.json.data.ready, false);
    assert.equal(status.json.data.message, "分时题库准备中");
    assert.equal(status.json.data.phaseStartsAt, null);
    assert.equal(typeof status.json.data.tapeCount, "number");
    assert.ok(status.json.data.tapeCount < 20);
    assertWhitelist(status.json.data);

    const auth = await register(`nr${Date.now().toString(36)}`);
    const before = getJiuCoinBalance(auth.user.id);
    const post = await postSession(auth, { mode: "ranked", startMode: "flat" }, `nr-${auth.user.id}`);
    assert.equal(post.status, 503, JSON.stringify(post.json));
    assert.equal(post.json.error.code, "INTRADAY_NOT_READY");
    assert.equal(getJiuCoinBalance(auth.user.id), before);
    assert.equal(JIU_COIN_INTRADAY_RANKED_COST, 30);
    assert.equal(JIU_COIN_INTRADAY_PRACTICE_COST, 10);
  });

  await t.test("ready library, phase gates do not charge", async () => {
    const lib = fillLibrary();
    assert.equal(lib.ready, true);
    setNow(Date.parse("2026-09-25T12:00:00.000Z"));
    seedNearIntradayChallenges();
    const status = await api("/api/v1/intraday");
    assert.equal(status.status, 200);
    assert.equal(status.json.data.ready, true);
    assert.equal(status.json.data.phaseStartsAt.flat, new Date(PHASE).toISOString());
    assert.equal(status.json.data.phaseStartsAt.long, new Date(LONG_PHASE).toISOString());

    const auth = await register(`ph${Date.now().toString(36)}`);
    const before = getJiuCoinBalance(auth.user.id);
    setNow(PHASE - 60_000 - 1);
    const early = await postSession(auth, { mode: "ranked", startMode: "flat" }, `early-${auth.user.id}`);
    assert.equal(early.status, 409, JSON.stringify(early.json));
    assert.equal(early.json.error.code, "PHASE_NOT_OPEN");
    assert.ok(early.json.error.details.phaseStartsAt);
    assert.equal(getJiuCoinBalance(auth.user.id), before);

    setNow(PHASE + 24100);
    const late = await postSession(auth, { mode: "ranked", startMode: "flat" }, `late-${auth.user.id}`);
    assert.equal(late.status, 409, JSON.stringify(late.json));
    assert.equal(late.json.error.code, "PHASE_CLOSED");
    assert.equal(getJiuCoinBalance(auth.user.id), before);
  });

  await t.test("waiting room create is revision 0 cursor -1 inside the entry window", async () => {
    const auth = await register(`wait${Date.now().toString(36)}`);
    const now = PHASE - 60_000;
    setNow(now);
    assert.equal(now, 1790341140000);
    const created = await postSession(auth, { mode: "ranked", startMode: "flat" }, `wait-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const data = created.json.data;
    assert.equal(data.revision, 0);
    assert.equal(data.cursor, -1);
    assert.deepEqual(data.bars, []);
    assert.equal(data.serverNowMs, now);
    assert.equal(data.phaseStartsAt, "2026-09-25T13:00:00.000Z");
    assert.ok(data.serverNowMs >= PHASE - 60_000 && data.serverNowMs < PHASE);
    assert.equal(data.position, "empty");
    assert.equal(data.markReturnPpm, 0);
    assert.equal(data.barIntervalMs, 100);
    assert.equal(data.barCount, 241);
    assert.equal(data.protocolVersion, "intraday-v1");
    assert.equal(data.scoreVersion, SCORE);
    assertWhitelist(data);
    await abandon(auth, data.sessionId);
  });

  await t.test("prefetch is at most 20 bars and a caught-up prefetch does not bump revision", async () => {
    const auth = await register(`pf${Date.now().toString(36)}`);
    setNow(PHASE - 60_000);
    const created = await postSession(auth, { mode: "ranked", startMode: "flat" }, `pf-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    setNow(PHASE + 100 * 100);
    const first = await advance(auth, sessionId, { expectedRevision: 0, op: "prefetch" }, `pf1-${auth.user.id}`);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.ok(first.json.data.bars.length <= 20);
    assert.equal(first.json.data.bars.length, 20);
    assert.equal(first.json.data.bars[0].i, 0);
    assert.equal(first.json.data.bars[19].i, 19);
    assert.equal(first.json.data.revision, 1);
    assert.equal(first.json.data.cursor, 19);
    assertWhitelist(first.json.data);
    for (const bar of first.json.data.bars) assert.ok(bar.i <= 100);

    const practice = await register(`pfn${Date.now().toString(36)}`);
    setNow(PHASE);
    const prac = await postSession(practice, { mode: "practice", startMode: "flat" }, `pfn-${practice.user.id}`);
    assert.equal(prac.status, 201, JSON.stringify(prac.json));
    assert.equal(prac.json.data.cursor, 0);
    assert.equal(prac.json.data.revision, 0);
    assert.equal(prac.json.data.phaseStartsAt, null);
    const noop = await advance(
      practice,
      prac.json.data.sessionId,
      { expectedRevision: 0, op: "prefetch" },
      `pfn-noop-${practice.user.id}`
    );
    assert.equal(noop.status, 200, JSON.stringify(noop.json));
    assert.equal(noop.json.data.revision, 0);
    assert.deepEqual(noop.json.data.bars, []);
    await abandon(auth, sessionId);
    await abandon(practice, prac.json.data.sessionId);
  });

  await t.test("released 100 returns bars 0-19; bar 100 is CURSOR_BEHIND; bar 0 slack then BAR_CLOSED", async () => {
    const auth = await register(`rel${Date.now().toString(36)}`);
    setNow(PHASE + 100 * 100);
    const created = await postSession(auth, { mode: "ranked", startMode: "flat" }, `rel-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const data = created.json.data;
    assert.equal(data.revision, 0);
    assert.equal(data.cursor, 19);
    assert.equal(data.bars.length, 20);
    assert.deepEqual(data.bars.map((bar) => bar.i), Array.from({ length: 20 }, (_, i) => i));
    assertWhitelist(data);
    const behind = await advance(auth, data.sessionId, {
      expectedRevision: 0,
      op: "act",
      actions: [{ barIndex: 100, side: "buy" }],
    }, `rel-act-${auth.user.id}`);
    assert.equal(behind.status, 409, JSON.stringify(behind.json));
    assert.equal(behind.json.error.code, "CURSOR_BEHIND");
    assert.equal(openDb().prepare(`SELECT revision FROM intraday_sessions WHERE id = ?`).get(data.sessionId).revision, 0);
    await abandon(auth, data.sessionId);

    const buyer = await register(`buy${Date.now().toString(36)}`);
    const origin = PHASE + 30_000;
    setNow(origin);
    const prac = await postSession(buyer, { mode: "practice", startMode: "flat" }, `buy-${buyer.user.id}`);
    assert.equal(prac.status, 201, JSON.stringify(prac.json));
    const bar0 = prac.json.data.bars.find((bar) => bar.i === 0);
    assert.ok(bar0);
    setNow(origin + 499);
    const okAct = await advance(buyer, prac.json.data.sessionId, {
      expectedRevision: 0,
      op: "act",
      actions: [{ barIndex: 0, side: "buy" }],
    }, `buy-act-${buyer.user.id}`);
    assert.equal(okAct.status, 200, JSON.stringify(okAct.json));
    assert.equal(okAct.json.data.fillBar.i, 0);
    assert.equal(okAct.json.data.fillBar.closeFen, bar0.closeFen);
    assert.notEqual(okAct.json.data.fillBar.closeFen, prac.json.data.bars.find((bar) => bar.i === 1)?.closeFen);
    assertWhitelist(okAct.json.data);

    const closedUser = await register(`cls${Date.now().toString(36)}`);
    const origin2 = origin + 10_000;
    setNow(origin2);
    const prac2 = await postSession(closedUser, { mode: "practice", startMode: "flat" }, `cls-${closedUser.user.id}`);
    assert.equal(prac2.status, 201, JSON.stringify(prac2.json));
    setNow(origin2 + 100 + 400);
    const closed = await advance(closedUser, prac2.json.data.sessionId, {
      expectedRevision: 0,
      op: "act",
      actions: [{ barIndex: 0, side: "buy" }],
    }, `cls-act-${closedUser.user.id}`);
    assert.equal(closed.status, 422, JSON.stringify(closed.json));
    assert.equal(closed.json.error.code, "BAR_CLOSED");
    await abandon(buyer, prac.json.data.sessionId);
    await abandon(closedUser, prac2.json.data.sessionId);
  });

  await t.test("finish waits for slack, then is idempotent on return_ppm", async () => {
    const auth = await register(`fin${Date.now().toString(36)}`);
    setNow(PHASE - 60_000);
    const created = await postSession(auth, { mode: "ranked", startMode: "flat" }, `fin-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    setNow(PHASE + 24100);
    const early = await finish(auth, sessionId, { expectedRevision: 0, finish: true }, `fin-early-${auth.user.id}`);
    assert.equal(early.status, 409, JSON.stringify(early.json));
    assert.equal(early.json.error.code, "TAPE_NOT_FINISHED");
    assert.equal(resultCount(sessionId), 0);

    setNow(PHASE + 24500);
    const done = await finish(auth, sessionId, { expectedRevision: 0, finish: true }, `fin-ok-${auth.user.id}`);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(resultCount(sessionId), 1);
    assert.equal(typeof done.json.data.returnPpm, "number");
    assertWhitelist(done.json.data);
    const again = await finish(auth, sessionId, { expectedRevision: 0, finish: true }, `fin-again-${auth.user.id}`);
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.data.returnPpm, done.json.data.returnPpm);
    assert.equal(resultCount(sessionId), 1);

    const after = await advance(auth, sessionId, { expectedRevision: 0, op: "prefetch" }, `fin-adv-${auth.user.id}`);
    assert.equal(after.status, 409, JSON.stringify(after.json));
    assert.equal(after.json.error.code, "GAME_NOT_ACTIVE");
    assert.equal(resultCount(sessionId), 1);
  });

  await t.test("paused practice past expires_at finishes 409 without a result row", async () => {
    const auth = await register(`exp${Date.now().toString(36)}`);
    const origin = Date.parse("2026-09-25T08:00:00.000Z");
    setNow(origin);
    const created = await postSession(auth, { mode: "practice", startMode: "flat" }, `exp-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    const paused = await advance(auth, sessionId, {
      expectedRevision: 0,
      op: "prefetch",
      pause: true,
    }, `exp-pause-${auth.user.id}`);
    assert.equal(paused.status, 200, JSON.stringify(paused.json));
    setNow(origin + 24100 + 90000);
    const done = await finish(auth, sessionId, { expectedRevision: 0, finish: true }, `exp-fin-${auth.user.id}`);
    assert.equal(done.status, 409, JSON.stringify(done.json));
    assert.equal(done.json.error.code, "GAME_NOT_ACTIVE");
    assert.notEqual(done.status, 500);
    const row = openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(sessionId);
    assert.equal(row.status, "expired");
    assert.equal(resultCount(sessionId), 0);
  });

  await t.test("abandon then finish is 409 and writes no result", async () => {
    const auth = await register(`ab${Date.now().toString(36)}`);
    setNow(Date.parse("2026-09-25T09:00:00.000Z"));
    const created = await postSession(auth, { mode: "practice", startMode: "long" }, `ab-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.data.position, "long");
    assert.equal(created.json.data.markReturnPpm, 0);
    const sessionId = created.json.data.sessionId;
    const left = await abandon(auth, sessionId);
    assert.equal(left.status, 200, JSON.stringify(left.json));
    const done = await finish(auth, sessionId, { expectedRevision: 0, finish: true }, `ab-fin-${auth.user.id}`);
    assert.equal(done.status, 409, JSON.stringify(done.json));
    assert.equal(done.json.error.code, "GAME_NOT_ACTIVE");
    assert.equal(resultCount(sessionId), 0);
    assert.equal(openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(sessionId).status, "abandoned");
  });

  await t.test("abandon after settleReady stays abandoned with no result row", async () => {
    const auth = await register(`abready${Date.now().toString(36)}`);
    const origin = Date.parse("2026-09-25T11:00:00.000Z");
    setNow(origin);
    const created = await postSession(auth, { mode: "practice", startMode: "flat" }, `abready-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    setNow(origin + 24500);
    const left = await abandon(auth, sessionId);
    assert.equal(left.status, 200, JSON.stringify(left.json));
    assert.equal(left.json.data.status, "abandoned");
    assert.equal(resultCount(sessionId), 0);
    assert.equal(openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(sessionId).status, "abandoned");
  });

  await t.test("rejected act does not commit pause or resume", async () => {
    const auth = await register(`nopause${Date.now().toString(36)}`);
    const origin = Date.parse("2026-09-25T05:00:00.000Z");
    setNow(origin);
    const created = await postSession(auth, { mode: "practice", startMode: "flat" }, `nopause-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    setNow(origin + 500);
    const rejected = await advance(auth, sessionId, {
      expectedRevision: 0,
      op: "act",
      pause: true,
      actions: [{ barIndex: 0, side: "buy" }],
    }, `nopause-act-${auth.user.id}`);
    assert.equal(rejected.status, 422, JSON.stringify(rejected.json));
    assert.equal(rejected.json.error.code, "BAR_CLOSED");
    const frozen = openDb().prepare(
      `SELECT clock_origin_ms, paused_at_ms FROM intraday_sessions WHERE id = ?`
    ).get(sessionId);
    assert.equal(frozen.paused_at_ms, null);
    assert.equal(frozen.clock_origin_ms, origin);

    const paused = await advance(auth, sessionId, {
      expectedRevision: 0,
      op: "prefetch",
      pause: true,
    }, `nopause-pf-${auth.user.id}`);
    assert.equal(paused.status, 200, JSON.stringify(paused.json));
    const held = openDb().prepare(
      `SELECT revision, clock_origin_ms, paused_at_ms FROM intraday_sessions WHERE id = ?`
    ).get(sessionId);
    assert.equal(held.paused_at_ms, origin + 500);
    setNow(origin + 500 + 10_000);
    const resume = await advance(auth, sessionId, {
      expectedRevision: held.revision,
      op: "act",
      pause: false,
      actions: [{ barIndex: 0, side: "buy" }],
    }, `nopause-resume-${auth.user.id}`);
    assert.equal(resume.status, 422, JSON.stringify(resume.json));
    const still = openDb().prepare(
      `SELECT clock_origin_ms, paused_at_ms FROM intraday_sessions WHERE id = ?`
    ).get(sessionId);
    assert.equal(still.paused_at_ms, held.paused_at_ms);
    assert.equal(still.clock_origin_ms, held.clock_origin_ms);
    await abandon(auth, sessionId);
  });

  await t.test("finish actions must match the server log; omitted actions settle", async () => {
    const auth = await register(`actlog${Date.now().toString(36)}`);
    const origin = Date.parse("2026-09-25T07:00:00.000Z");
    setNow(origin);
    const created = await postSession(auth, { mode: "practice", startMode: "flat" }, `act-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;
    const acted = await advance(auth, sessionId, {
      expectedRevision: 0,
      op: "act",
      actions: [{ barIndex: 0, side: "buy" }],
    }, `act-buy-${auth.user.id}`);
    assert.equal(acted.status, 200, JSON.stringify(acted.json));
    setNow(origin + 24500);
    const bad = await finish(auth, sessionId, {
      expectedRevision: 1,
      finish: true,
      actions: [{ barIndex: 0, side: "sell" }],
    }, `act-bad-${auth.user.id}`);
    assert.equal(bad.status, 409, JSON.stringify(bad.json));
    assert.equal(bad.json.error.code, "SUBMISSION_CONFLICT");
    assert.equal(resultCount(sessionId), 0);
    assert.equal(
      openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(sessionId).status,
      "active"
    );

    const plain = await register(`omit${Date.now().toString(36)}`);
    const origin2 = origin + 60_000;
    setNow(origin2);
    const second = await postSession(plain, { mode: "practice", startMode: "flat" }, `omit-${plain.user.id}`);
    assert.equal(second.status, 201, JSON.stringify(second.json));
    setNow(origin2 + 24500);
    const ok = await finish(plain, second.json.data.sessionId, {
      expectedRevision: 0,
      finish: true,
    }, `omit-fin-${plain.user.id}`);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(resultCount(second.json.data.sessionId), 1);
  });

  await t.test("idempotent create does not charge twice", async () => {
    const auth = await register(`idem${Date.now().toString(36)}`);
    setNow(Date.parse("2026-09-25T06:00:00.000Z"));
    const before = getJiuCoinBalance(auth.user.id);
    const key = `idem-${auth.user.id}`;
    const first = await postSession(auth, { mode: "practice", startMode: "flat" }, key);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const second = await postSession(auth, { mode: "practice", startMode: "flat" }, key);
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(second.json.data.sessionId, first.json.data.sessionId);
    assert.ok(first.json.data.bars.length >= 1);
    assert.deepEqual(second.json.data.bars, first.json.data.bars);
    assert.equal(getJiuCoinBalance(auth.user.id), before - JIU_COIN_INTRADAY_PRACTICE_COST);
    const charges = openDb().prepare(
      `SELECT COUNT(*) AS c FROM jiu_coin_ledger WHERE reason = 'game_create' AND ref_id = ?`
    ).get(first.json.data.sessionId).c;
    assert.equal(charges, 1);
    await abandon(auth, first.json.data.sessionId);
  });

  await t.test("each startMode can be used once", async () => {
    const auth = await register(`once${Date.now().toString(36)}`);
    setNow(PHASE - 60_000);
    const flat = await postSession(auth, { mode: "ranked", startMode: "flat" }, `once-f-${auth.user.id}`);
    assert.equal(flat.status, 201, JSON.stringify(flat.json));
    assert.equal((await abandon(auth, flat.json.data.sessionId)).status, 200);
    const flatAgain = await postSession(auth, { mode: "ranked", startMode: "flat" }, `once-f2-${auth.user.id}`);
    assert.equal(flatAgain.status, 409, JSON.stringify(flatAgain.json));

    setNow(LONG_PHASE - 60_000);
    const before = getJiuCoinBalance(auth.user.id);
    const long = await postSession(auth, { mode: "ranked", startMode: "long" }, `once-l-${auth.user.id}`);
    assert.equal(long.status, 201, JSON.stringify(long.json));
    assert.equal(long.json.data.position, "long");
    assert.equal(long.json.data.revision, 0);
    assert.equal((await abandon(auth, long.json.data.sessionId)).status, 200);
    const after = getJiuCoinBalance(auth.user.id);
    const longAgain = await postSession(auth, { mode: "ranked", startMode: "long" }, `once-l2-${auth.user.id}`);
    assert.equal(longAgain.status, 409, JSON.stringify(longAgain.json));
    assert.equal(getJiuCoinBalance(auth.user.id), after);
    assert.equal(before - after, JIU_COIN_INTRADAY_RANKED_COST);
  });

  await t.test("seed twice keeps one row and the same tape_id; a full symbol cycle inserts nothing", async () => {
    setNow(Date.parse("2026-09-25T12:00:00.000Z"));
    const db = openDb();
    const before = db.prepare(`SELECT tape_id FROM intraday_challenges WHERE challenge_date = ?`).get(DAY);
    assert.ok(before);
    const created = seedNearIntradayChallenges();
    assert.equal(created, 0);
    const after = db.prepare(`SELECT tape_id, COUNT(*) AS c FROM intraday_challenges WHERE challenge_date = ?`).get(DAY);
    assert.equal(after.tape_id, before.tape_id);
    assert.equal(Number(db.prepare(`SELECT COUNT(*) AS c FROM intraday_challenges WHERE challenge_date = ?`).get(DAY).c), 1);

    const dupes = db.prepare(
      `SELECT challenge_date, COUNT(*) AS c FROM intraday_challenges GROUP BY challenge_date HAVING c > 1`
    ).all();
    assert.deepEqual(dupes, []);

    const eligible = [
      { id: "a", symbol: "600001", session_date: "2026-09-01" },
      { id: "b", symbol: "600002", session_date: "2026-09-02" },
    ];
    assert.equal(pickChallengeTape("2026-09-25", eligible, ["600001", "600002"]), null);
    let walked = false;
    for (let n = 0; n < 400; n += 1) {
      const ymd = new Date(Date.parse("2026-01-01T00:00:00.000Z") + n * 86400000).toISOString().slice(0, 10);
      const picked = pickChallengeTape(ymd, eligible, ["600001"]);
      assert.equal(picked.symbol, "600002");
      const digest = crypto.createHash("sha256").update(`${ymd}\n${SCORE}`, "utf8").digest();
      const idx = digest.readUInt32BE(0) % 2;
      if (idx === 0) walked = true;
    }
    assert.equal(walked, true);

    const Database = (await import("better-sqlite3")).default;
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");
    migrate(mem);
    const samples = db.prepare(`SELECT * FROM intraday_tapes ORDER BY symbol LIMIT 2`).all();
    assert.equal(samples.length, 2);
    const insert = mem.prepare(
      `INSERT INTO intraday_tapes (
        id, pack_version, symbol, name, session_date, prev_close_fen, limit_pct,
        bar_count, bars_json, sha256, eligible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of samples) {
      insert.run(
        row.id, row.pack_version, row.symbol, row.name, row.session_date, row.prev_close_fen,
        row.limit_pct, row.bar_count, row.bars_json, row.sha256, row.eligible
      );
    }
    const putChallenge = mem.prepare(
      `INSERT INTO intraday_challenges (
        id, challenge_date, opens_at, closes_at, flat_phase_starts_at, long_phase_starts_at,
        tape_id, score_version, snapshot_sha256, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`
    );
    samples.forEach((row, i) => {
      const ymd = `2031-01-0${i + 1}`;
      putChallenge.run(
        `intraday:${ymd}`, ymd, `${ymd}T00:00:00.000Z`, `2031-01-0${i + 2}T00:00:00.000Z`,
        `${ymd}T13:00:00.000Z`, `${ymd}T13:05:00.000Z`, row.id, SCORE, row.sha256
      );
    });
    const wrote = ensureIntradayChallenge(mem, "2031-01-03");
    assert.equal(wrote, false);
    assert.equal(mem.prepare(`SELECT id FROM intraday_challenges WHERE challenge_date = '2031-01-03'`).get(), undefined);
    mem.close();

    const libUrl = pathToFileURL(path.join(__dirname, "../src/lib/intraday.js")).href;
    const code = `import { seedNearIntradayChallenges } from ${JSON.stringify(libUrl)};\nconsole.log(String(seedNearIntradayChallenges()));\n`;
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
        env: process.env,
        cwd: path.resolve(__dirname, "../.."),
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (buf) => { out += buf; });
      child.stderr.on("data", (buf) => { err += buf; });
      child.on("exit", (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(err || out))));
    });
    await Promise.all([run(), run()]);
    const still = openDb().prepare(`SELECT tape_id FROM intraday_challenges WHERE challenge_date = ?`).get(DAY);
    assert.equal(still.tape_id, before.tape_id);
    assert.equal(Number(openDb().prepare(`SELECT COUNT(*) AS c FROM intraday_challenges WHERE challenge_date = ?`).get(DAY).c), 1);
  });

  await t.test("sweep settles the flat session when long opens at 21:04 and charges 30 once more", async () => {
    const auth = await register(`sw${Date.now().toString(36)}`);
    setNow(PHASE - 60_000);
    const before = getJiuCoinBalance(auth.user.id);
    const flat = await postSession(auth, { mode: "ranked", startMode: "flat" }, `sw-f-${auth.user.id}`);
    assert.equal(flat.status, 201, JSON.stringify(flat.json));
    const flatId = flat.json.data.sessionId;
    assert.equal(openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(flatId).status, "active");
    setNow(LONG_PHASE - 60_000);
    const long = await postSession(auth, { mode: "ranked", startMode: "long" }, `sw-l-${auth.user.id}`);
    assert.equal(long.status, 201, JSON.stringify(long.json));
    assert.equal(getJiuCoinBalance(auth.user.id), before - 2 * JIU_COIN_INTRADAY_RANKED_COST);
    assert.equal(openDb().prepare(`SELECT status FROM intraday_sessions WHERE id = ?`).get(flatId).status, "settled");
    assert.equal(resultCount(flatId), 1);
    assert.equal(resultCount(long.json.data.sessionId), 0);
    const board = await api(`/api/v1/intraday/leaderboard?startMode=flat&date=${DAY}`);
    assert.equal(board.status, 200, JSON.stringify(board.json));
    assert.ok(board.json.data.entries.length >= 1);
    for (const entry of board.json.data.entries) {
      assert.equal("symbol" in entry, false);
      assert.equal("sessionDate" in entry, false);
      assert.equal(typeof entry.returnPct, "string");
      assert.equal(typeof entry.tradeCount, "number");
      assert.ok(entry.nickname);
    }
    await abandon(auth, long.json.data.sessionId);
  });

  await t.test("no intraday row: classic, daily, ghost, and puzzle creates succeed", async () => {
    setNow(Date.parse("2026-09-25T04:00:00.000Z"));
    const dailyUser = await register(`dly${Date.now().toString(36)}`);
    const daily = await api("/api/v1/daily-challenge/games", {
      method: "POST",
      csrf: dailyUser.csrfToken,
      headers: { "Idempotency-Key": `daily-cross-${dailyUser.user.id}` },
    });
    assert.equal(daily.status, 201, JSON.stringify(daily.json));
    const fin = await api(`/api/v1/games/${daily.json.data.game.gameId}/finish`, {
      method: "POST",
      csrf: dailyUser.csrfToken,
      headers: { "Idempotency-Key": `daily-fin-${dailyUser.user.id}` },
      body: { actions: actionsObj(holds()), finish: true },
    });
    assert.ok(fin.status === 200 || fin.status === 201, JSON.stringify(fin.json));

    const classicUser = await register(`cl${Date.now().toString(36)}`);
    const classic = await api("/api/v1/games", {
      method: "POST",
      csrf: classicUser.csrfToken,
      headers: { "Idempotency-Key": `classic-cross-${classicUser.user.id}` },
      body: {
        fillMode: "next_open",
        pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
      },
    });
    assert.equal(classic.status, 201, JSON.stringify(classic.json));

    const puzzleUser = await register(`pz${Date.now().toString(36)}`);
    const puzzle = await api("/api/v1/puzzles/ch1-01/entries", {
      method: "POST",
      csrf: puzzleUser.csrfToken,
      headers: { "Idempotency-Key": `puzzle-cross-${puzzleUser.user.id}` },
      body: {},
    });
    assert.equal(puzzle.status, 201, JSON.stringify(puzzle.json));

    setNow(Date.parse("2026-09-26T04:00:00.000Z"));
    const ghostUser = await register(`gh${Date.now().toString(36)}`);
    const ghost = await api("/api/v1/daily-challenge/ghost/games", {
      method: "POST",
      csrf: ghostUser.csrfToken,
      headers: { "Idempotency-Key": `ghost-cross-${ghostUser.user.id}` },
    });
    assert.equal(ghost.status, 201, JSON.stringify(ghost.json));
  });

  await t.test("unexpired intraday session blocks classic, daily, ghost, and puzzle", async () => {
    setNow(Date.parse("2026-09-26T05:00:00.000Z"));
    const auth = await register(`blk${Date.now().toString(36)}`);
    const created = await postSession(auth, { mode: "practice", startMode: "flat" }, `blk-${auth.user.id}`);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const sessionId = created.json.data.sessionId;

    const classic = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `block-classic-${auth.user.id}` },
      body: {
        fillMode: "next_open",
        pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
      },
    });
    const daily = await api("/api/v1/daily-challenge/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `block-daily-${auth.user.id}` },
    });
    const ghost = await api("/api/v1/daily-challenge/ghost/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `block-ghost-${auth.user.id}` },
    });
    const puzzle = await api("/api/v1/puzzles/ch1-01/entries", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `block-puzzle-${auth.user.id}` },
    });
    for (const res of [classic, daily, ghost, puzzle]) {
      assert.equal(res.status, 409, JSON.stringify(res.json));
      assert.equal(res.json.error.code, "ACTIVE_GAME_EXISTS");
      assert.deepEqual(res.json.error.details, { kind: "intraday", sessionId });
      assert.equal(res.json.error.details.game, undefined);
    }
  });

  await t.test("game_sessions conflict keeps game and gameId", async () => {
    setNow(Date.parse("2026-09-26T06:00:00.000Z"));
    const auth = await register(`gconf${Date.now().toString(36)}`);
    const first = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `game-conflict-1-${auth.user.id}` },
      body: {
        fillMode: "next_open",
        pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
      },
    });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const second = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `game-conflict-2-${auth.user.id}` },
      body: {
        fillMode: "next_open",
        pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
      },
    });
    assert.equal(second.status, 409, JSON.stringify(second.json));
    const details = second.json.error.details;
    assert.equal(details.game.gameId, first.json.data.gameId);
    assert.equal(details.gameId, first.json.data.gameId);
    assert.equal(details.kind, "classic");
    assert.equal(details.sessionId, first.json.data.gameId);
  });

  await t.test("POST /games still rejects gameKind=intraday", async () => {
    const auth = await register(`badk${Date.now().toString(36)}`);
    const create = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `bad-kind-${auth.user.id}` },
      body: { fillMode: "next_open", gameKind: "intraday" },
    });
    assert.equal(create.status, 400);
    assert.equal(create.json.error.code, "INVALID_GAME_KIND");
  });
});
