import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { WebSocket } from "ws";
import { prepareTestEnv } from "../helpers.js";
import { NOW, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { config } = await import("../../src/lib/config.js");
const { sha256Hex } = await import("../../src/lib/crypto.js");
const { createSession, revokeAllUserSessions, revokeSessionToken } = await import("../../src/lib/sessions.js");
const { acceptChallenge, createChallenge, markReady } = await import("../../src/lib/pvp/challenges.js");
const { resetRateLimitBuckets } = await import("../../src/lib/rateLimit.js");
const { startTestServer } = await import("../helpers.js");
const {
  attachPvpRealtime,
  detachPvpRealtime,
  flushPvpPushes,
  issueWsTicket,
  noteChallengeChanged,
  noteLobbyChanged,
  noteMatchChanged,
  openPvpSockets,
  revalidateSockets,
  setPvpCoalesceMs,
} = await import("../../src/lib/pvp/realtime.js");

config.pvpBattleEnabled = true;

let keyN = 0;

function key(label) {
  keyN += 1;
  return `rt-${label}-${keyN}-0123456789abcdef`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cookie(session) {
  return `${config.cookieName}=${session.sessionToken}`;
}

function connectSocket({ port, ticket, cookieHeader, origin }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const headers = { Cookie: cookieHeader };
    if (origin) headers.Origin = origin;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/pvp/ws?ticket=${encodeURIComponent(ticket)}`,
      { headers, perMessageDeflate: false }
    );
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        ws.terminate();
        reject(err);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish(new Error("socket timeout")), 3000);
    ws.once("open", () => finish(null, ws));
    ws.once("unexpected-response", (_req, res) => {
      const statusCode = res.statusCode;
      res.resume();
      const err = new Error(`status ${statusCode}`);
      err.statusCode = statusCode;
      finish(err);
    });
    ws.once("error", (err) => {
      const match = /Unexpected server response: (\d+)/.exec(err.message || "");
      if (match) err.statusCode = Number(match[1]);
      finish(err);
    });
  });
}

function nextMessage(ws, ms = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("no message"));
    }, ms);
    const onMessage = (data) => {
      cleanup();
      resolve(JSON.parse(String(data)));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("closed before message"));
    };
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
    }
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}

function untilClose(ws, ms = 2000) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("not closed")), ms);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function closeQuiet(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already gone */ }
      resolve();
    }, 500);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    try { ws.close(1000); } catch { resolve(); }
  });
}

function assertInvalidation(msg, matchId) {
  assert.deepEqual(Object.keys(msg).sort(), ["matchId", "revision", "serverNow", "t"]);
  assert.equal(msg.t, "match.changed");
  assert.equal(msg.matchId, matchId);
  assert.equal(typeof msg.revision, "number");
  assert.equal(typeof msg.serverNow, "number");
}

test("A01 A02 websocket ticket, origin, and invalidation", async () => {
  const previousMax = config.pvpMaxWs;
  const http = await startTestServer();
  const port = http.server.address().port;
  attachPvpRealtime(http.server);
  setPvpCoalesceMs(60_000);
  const opened = [];
  const db = openDb();

  async function postTicket(session, { origin, csrf = true } = {}) {
    const headers = { Cookie: cookie(session) };
    if (origin !== undefined) headers.Origin = origin;
    return http.api("/api/v1/pvp/ws-ticket", {
      method: "POST",
      body: {},
      csrf: csrf ? session.csrfToken : undefined,
      headers,
    });
  }

  async function connect(ticket, session, origin = "http://127.0.0.1") {
    const ws = await connectSocket({
      port,
      ticket,
      cookieHeader: cookie(session),
      origin,
    });
    opened.push(ws);
    return ws;
  }

  async function shutOpened() {
    const batch = opened.splice(0);
    await Promise.all(batch.map(closeQuiet));
    for (let i = 0; i < 20 && openPvpSockets().length; i += 1) await delay(10);
    assert.equal(openPvpSockets().length, 0);
  }

  function startMatch() {
    const a = seedUser(db, { name: `rt-a-${crypto.randomUUID()}` });
    const b = seedUser(db, { name: `rt-b-${crypto.randomUUID()}` });
    const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("c"), now: NOW });
    assert.equal(created.ok, true, JSON.stringify(created));
    const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(markReady(db, { matchId: accepted.matchId, userId: a, now: NOW + 1 }).waiting, true);
    const started = markReady(db, { matchId: accepted.matchId, userId: b, now: NOW + 2 });
    assert.equal(started.started, true, JSON.stringify(started));
    const snap = JSON.parse(db.prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(accepted.matchId).snapshot_json);
    const now = Date.now();
    db.prepare(`UPDATE pvp_matches SET round_opens_at = ?, round_deadline_at = ? WHERE id = ?`).run(
      now - 1000,
      now + 30_000,
      accepted.matchId
    );
    return { a, b, matchId: accepted.matchId, stockCode: snap.stockCode, stockName: snap.stockName };
  }

  try {
    const user = seedUser(db, { name: `rt-u-${crypto.randomUUID()}` });
    const session = createSession(user);

    const noCsrf = await postTicket(session, { origin: "http://127.0.0.1", csrf: false });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error.code, "CSRF_FAILED");

    const evil = await postTicket(session, { origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    assert.equal(evil.json.error.code, "ORIGIN_DENIED");

    config.pvpBattleEnabled = false;
    const flagOff = await postTicket(session, { origin: "http://127.0.0.1" });
    assert.equal(flagOff.status, 200);
    assert.equal(flagOff.res.headers.get("cache-control"), "no-store");
    config.pvpBattleEnabled = true;

    const missingOrigin = await postTicket(session, {});
    assert.equal(missingOrigin.status, 200);
    const missingOriginSocket = await connect(missingOrigin.json.data.ticket, session, null).then(
      () => null,
      (err) => err
    );
    assert.equal(missingOriginSocket.statusCode, 403);
    const reused = await connect(missingOrigin.json.data.ticket, session);
    assert.equal(reused.readyState, WebSocket.OPEN);

    const replayDenied = await connect(missingOrigin.json.data.ticket, session).then(
      () => null,
      (err) => err
    );
    assert.equal(replayDenied.statusCode, 401);
    await shutOpened();

    const expired = issueWsTicket({ userId: user, sessionToken: session.sessionToken, now: Date.now() - 31_000 });
    const expiredDenied = await connect(expired.ticket, session).then(() => null, (err) => err);
    assert.equal(expiredDenied.statusCode, 401);

    const pingTicket = await postTicket(session, { origin: "http://127.0.0.1" });
    const pingSocket = await connect(pingTicket.json.data.ticket, session);
    const pong = nextMessage(pingSocket);
    pingSocket.send(JSON.stringify({ t: "ping" }));
    const pongMsg = await pong;
    assert.deepEqual(Object.keys(pongMsg).sort(), ["serverNow", "t"]);
    assert.equal(pongMsg.t, "pong");

    const challengeNote = nextMessage(pingSocket);
    noteChallengeChanged("challenge-note", [user]);
    flushPvpPushes();
    const challengeMsg = await challengeNote;
    assert.deepEqual(Object.keys(challengeMsg).sort(), ["challengeId", "serverNow", "t"]);
    assert.equal(challengeMsg.t, "challenge.changed");
    assert.equal(challengeMsg.challengeId, "challenge-note");

    const lobbyNote = nextMessage(pingSocket);
    noteLobbyChanged();
    flushPvpPushes();
    const lobbyMsg = await lobbyNote;
    assert.deepEqual(Object.keys(lobbyMsg).sort(), ["serverNow", "t"]);
    assert.equal(lobbyMsg.t, "lobby.changed");
    await shutOpened();

    const match = startMatch();
    const strangerUser = seedUser(db, { name: `rt-s-${crypto.randomUUID()}` });
    const stranger = createSession(strangerUser);
    const player = createSession(match.a);
    const opponent = createSession(match.b);
    const peek = await http.api(`/api/v1/pvp/matches/${match.matchId}`, {
      headers: { Cookie: cookie(stranger) },
    });
    assert.equal(peek.status, 404);
    assert.equal(JSON.stringify(peek.json).includes(match.stockCode), false);
    assert.equal(JSON.stringify(peek.json).includes(match.stockName), false);

    const strangerTicket = await postTicket(stranger, { origin: "http://127.0.0.1" });
    const playerTicket = await postTicket(player, { origin: "http://127.0.0.1" });
    const strangerSocket = await connect(strangerTicket.json.data.ticket, stranger);
    const playerSocket = await connect(playerTicket.json.data.ticket, player);
    const strangerWait = nextMessage(strangerSocket, 400);
    const playerWait = nextMessage(playerSocket, 400);
    strangerSocket.send(JSON.stringify({ t: "sync", matchId: match.matchId }));
    await delay(50);
    flushPvpPushes();
    await assert.rejects(strangerWait, /no message/);
    await assert.rejects(playerWait, /no message/);

    const synced = nextMessage(playerSocket);
    playerSocket.send(JSON.stringify({ t: "sync", matchId: match.matchId }));
    await delay(50);
    flushPvpPushes();
    const syncedMsg = await synced;
    assertInvalidation(syncedMsg, match.matchId);
    assert.equal(JSON.stringify(syncedMsg).includes(match.stockCode), false);
    assert.equal(JSON.stringify(syncedMsg).includes(match.stockName), false);

    const opponentTicket = await postTicket(opponent, { origin: "http://127.0.0.1" });
    const opponentSocket = await connect(opponentTicket.json.data.ticket, opponent);
    const playerPush = nextMessage(playerSocket, 2000);
    const opponentPush = nextMessage(opponentSocket, 2000);
    const action = await http.api(`/api/v1/pvp/matches/${match.matchId}/actions`, {
      method: "POST",
      csrf: player.csrfToken,
      body: { round: 1, action: "hold" },
      headers: {
        Cookie: cookie(player),
        Origin: "http://127.0.0.1",
        "Idempotency-Key": key("act"),
      },
    });
    assert.equal(action.status, 200, JSON.stringify(action.json));
    flushPvpPushes();
    const [left, right] = await Promise.all([playerPush, opponentPush]);
    assertInvalidation(left, match.matchId);
    assertInvalidation(right, match.matchId);
    assert.equal(JSON.stringify(left).includes("hold"), false);
    assert.equal(JSON.stringify(right).includes(match.stockCode), false);
    await shutOpened();

    const deviceA = createSession(match.a);
    const deviceB = createSession(match.a);
    const deviceATicket = await postTicket(deviceA, { origin: "http://127.0.0.1" });
    const deviceBTicket = await postTicket(deviceB, { origin: "http://127.0.0.1" });
    const deviceASocket = await connect(deviceATicket.json.data.ticket, deviceA);
    const deviceBSocket = await connect(deviceBTicket.json.data.ticket, deviceB);
    let otherClosed = false;
    deviceBSocket.once("close", () => {
      otherClosed = true;
    });
    const deviceAClosed = untilClose(deviceASocket);
    revokeSessionToken(deviceA.sessionToken);
    assert.equal(await deviceAClosed, 4001);
    await delay(50);
    assert.equal(otherClosed, false);
    assert.equal(deviceBSocket.readyState, WebSocket.OPEN);

    db.prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).run(sha256Hex(deviceB.sessionToken));
    const deviceBClosed = untilClose(deviceBSocket);
    revalidateSockets();
    assert.equal(await deviceBClosed, 4001);
    await shutOpened();

    const disabledUser = seedUser(db, { name: `rt-d-${crypto.randomUUID()}` });
    const disabledSession = createSession(disabledUser);
    const disabledTicket = await postTicket(disabledSession, { origin: "http://127.0.0.1" });
    const disabledSocket = await connect(disabledTicket.json.data.ticket, disabledSession);
    db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(disabledUser);
    const disabledClosed = untilClose(disabledSocket);
    revalidateSockets();
    assert.equal(await disabledClosed, 4001);

    const revokeAllUser = seedUser(db, { name: `rt-all-${crypto.randomUUID()}` });
    const allA = createSession(revokeAllUser);
    const allB = createSession(revokeAllUser);
    const allASocket = await connect((await postTicket(allA, { origin: "http://127.0.0.1" })).json.data.ticket, allA);
    const allBSocket = await connect((await postTicket(allB, { origin: "http://127.0.0.1" })).json.data.ticket, allB);
    const allAClosed = untilClose(allASocket);
    const allBClosed = untilClose(allBSocket);
    revokeAllUserSessions(revokeAllUser);
    assert.equal(await allAClosed, 4001);
    assert.equal(await allBClosed, 4001);
    await shutOpened();

    const schemaSession = createSession(match.b);
    const schemaTicket = await postTicket(schemaSession, { origin: "http://127.0.0.1" });
    const schemaSocket = await connect(schemaTicket.json.data.ticket, schemaSession);
    const unsupported = untilClose(schemaSocket);
    schemaSocket.send(JSON.stringify({ t: "ping", extra: true }));
    assert.equal(await unsupported, 1008);

    const binaryTicket = await postTicket(schemaSession, { origin: "http://127.0.0.1" });
    const binarySocket = await connect(binaryTicket.json.data.ticket, schemaSession);
    const binaryClosed = untilClose(binarySocket);
    binarySocket.send(Buffer.from([1, 2, 3]));
    assert.equal(await binaryClosed, 1003);

    const hugeTicket = await postTicket(schemaSession, { origin: "http://127.0.0.1" });
    const hugeSocket = await connect(hugeTicket.json.data.ticket, schemaSession);
    const hugeClosed = untilClose(hugeSocket);
    hugeSocket.send("x".repeat(5000));
    assert.equal(await hugeClosed, 1009);
    await shutOpened();

    const slowSession = createSession(match.a);
    const slowTicket = await postTicket(slowSession, { origin: "http://127.0.0.1" });
    const slowSocket = await connect(slowTicket.json.data.ticket, slowSession);
    const serverSocket = openPvpSockets().find((sock) => sock.pvp?.userId === match.a && sock.pvp?.sessionHash === sha256Hex(slowSession.sessionToken));
    assert.ok(serverSocket);
    Object.defineProperty(serverSocket, "bufferedAmount", { configurable: true, value: 256 * 1024 + 1 });
    const slowClosed = untilClose(slowSocket);
    noteMatchChanged(match.matchId);
    flushPvpPushes();
    assert.equal(await slowClosed, 1009);
    await shutOpened();

    const capped = createSession(seedUser(db, { name: `rt-cap-${crypto.randomUUID()}` }));
    for (let i = 0; i < 3; i += 1) {
      const issued = await postTicket(capped, { origin: "http://127.0.0.1" });
      assert.equal(issued.status, 200);
      await connect(issued.json.data.ticket, capped);
    }
    const fourth = await postTicket(capped, { origin: "http://127.0.0.1" });
    const fourthDenied = await connect(fourth.json.data.ticket, capped).then(() => null, (err) => err);
    assert.equal(fourthDenied.statusCode, 429);
    await shutOpened();

    config.pvpMaxWs = 1;
    const globalA = createSession(seedUser(db, { name: `rt-g1-${crypto.randomUUID()}` }));
    const globalB = createSession(seedUser(db, { name: `rt-g2-${crypto.randomUUID()}` }));
    const globalOpen = await postTicket(globalA, { origin: "http://127.0.0.1" });
    await connect(globalOpen.json.data.ticket, globalA);
    const globalDeniedTicket = await postTicket(globalB, { origin: "http://127.0.0.1" });
    const globalDenied = await connect(globalDeniedTicket.json.data.ticket, globalB).then(() => null, (err) => err);
    assert.equal(globalDenied.statusCode, 429);
    config.pvpMaxWs = previousMax;
    await shutOpened();

    resetRateLimitBuckets();
    const limitedUser = createSession(seedUser(db, { name: `rt-rate-${crypto.randomUUID()}` }));
    for (let i = 0; i < 10; i += 1) {
      const issued = await postTicket(limitedUser, { origin: "http://127.0.0.1" });
      assert.equal(issued.status, 200, `ticket ${i} ${issued.status}`);
    }
    const limited = await postTicket(limitedUser, { origin: "http://127.0.0.1" });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, "RATE_LIMITED");
  } finally {
    config.pvpMaxWs = previousMax;
    config.pvpBattleEnabled = true;
    setPvpCoalesceMs(200);
    await Promise.all(opened.splice(0).map(closeQuiet));
    detachPvpRealtime();
    await http.stop();
    closeDb();
  }
});
