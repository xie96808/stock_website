import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { expireDueReady } = await import("../../src/lib/pvp/challenges.js");
const { clearPresence } = await import("../../src/lib/pvp/presence.js");
const { createSession } = await import("../../src/lib/sessions.js");
const { startTestServer } = await import("../helpers.js");

config.pvpBattleEnabled = true;
migrate();
const http = await startTestServer();
let keyN = 0;

function key(label) {
  keyN += 1;
  return `lobby-${label}-${keyN}-0123456789abcdef`;
}

function sessionFor(name, extra = {}) {
  const id = seedUser(openDb(), { name: `${name}-${crypto.randomUUID()}`, ...extra });
  return { id, session: createSession(id) };
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

test("lobby presence, decline, ready reveal, forfeit, and flag-off summary", async () => {
  try {
    const guest = await call(null, "/api/v1/pvp/lobby/summary");
    assert.equal(guest.status, 200);
    assert.equal(guest.json.data.availableCount, 0);
    assert.equal(JSON.stringify(guest.json).includes("nickname"), false);

    const locked = await call(null, "/api/v1/pvp/lobby");
    assert.equal(locked.status, 401);

    const poor = sessionFor("poor", { balance: 0 });
    const poorState = await call(poor.session, "/api/v1/me/pvp/state");
    assert.equal(poorState.json.data.eligibility.code, "INSUFFICIENT_FUNDS");
    assert.match(poorState.json.data.eligibility.message, /韭币不足/);

    const offline = sessionFor("off-a");
    const quiet = sessionFor("off-b");
    const missed = await call(offline.session, "/api/v1/pvp/challenges", {
      method: "POST",
      body: { toUserId: quiet.id },
      idempotencyKey: key("offline"),
    });
    assert.equal(missed.status, 409);
    assert.equal(missed.json.error.code, "OFFLINE");

    const sender = sessionFor("send");
    const target = sessionFor("target");
    const on = await call(target.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: true },
    });
    assert.equal(on.status, 200);
    assert.equal(on.json.data.available, true);
    const summary = await call(null, "/api/v1/pvp/lobby/summary");
    assert.equal(summary.json.data.availableCount >= 1, true);
    assert.equal(JSON.stringify(summary.json).includes("nickname"), false);
    // Authenticated summary must not count the viewer as an opponent.
    assert.equal((await call(sender.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: true },
    })).status, 200);
    const asGuest = await call(null, "/api/v1/pvp/lobby/summary");
    const asSender = await call(sender.session, "/api/v1/pvp/lobby/summary");
    assert.equal(asSender.json.data.availableCount, asGuest.json.data.availableCount - 1);
    await call(sender.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: false },
    });

    const listed = await call(sender.session, "/api/v1/pvp/lobby?limit=50");
    assert.equal(listed.status, 200);
    const row = listed.json.data.entries.find((entry) => entry.userId === target.id);
    assert.ok(row);
    assert.equal(row.nickname, listed.json.data.entries.find((entry) => entry.userId === target.id).nickname);
    assert.match(row.title, /定级中/);
    assert.equal(row.rating, undefined);
    assert.equal(listed.json.data.entries.some((entry) => entry.userId === sender.id), false);

    const created = await call(sender.session, "/api/v1/pvp/challenges", {
      method: "POST",
      body: { toUserId: target.id },
      idempotencyKey: key("create"),
    });
    assert.equal(created.status, 201);
    const declined = await call(target.session, `/api/v1/pvp/challenges/${created.json.data.challengeId}/respond`, {
      method: "POST",
      body: { accept: false },
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.data.status, "declined");

    const again = await call(sender.session, "/api/v1/pvp/challenges", {
      method: "POST",
      body: { toUserId: target.id },
      idempotencyKey: key("again"),
    });
    assert.equal(again.status, 201);
    const strangerCancel = await call(target.session, `/api/v1/pvp/challenges/${again.json.data.challengeId}/cancel`, {
      method: "POST",
      body: {},
    });
    assert.equal(strangerCancel.status, 404);
    const cancelled = await call(sender.session, `/api/v1/pvp/challenges/${again.json.data.challengeId}/cancel`, {
      method: "POST",
      body: {},
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.data.status, "cancelled");

    const host = sessionFor("host");
    const guestPlayer = sessionFor("guest");
    assert.equal((await call(guestPlayer.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: true },
    })).status, 200);
    const invite = await call(host.session, "/api/v1/pvp/challenges", {
      method: "POST",
      body: { toUserId: guestPlayer.id },
      idempotencyKey: key("ready"),
    });
    const accepted = await call(guestPlayer.session, `/api/v1/pvp/challenges/${invite.json.data.challengeId}/respond`, {
      method: "POST",
      body: { accept: true },
    });
    assert.equal(accepted.status, 200);
    const matchId = accepted.json.data.matchId;
    expireDueReady(openDb(), Date.now() + 60_000);
    const timedOut = await call(host.session, `/api/v1/pvp/matches/${matchId}`);
    assert.equal(timedOut.json.data.status, "aborted");
    assert.equal(timedOut.json.data.terminal.reason, "ready_timeout");
    assert.equal(timedOut.json.data.me.coinDelta, 0);
    assert.equal(timedOut.json.data.identity, undefined);

    const a = sessionFor("play-a");
    const b = sessionFor("play-b");
    assert.equal((await call(b.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: true },
    })).status, 200);
    const challenge = await call(a.session, "/api/v1/pvp/challenges", {
      method: "POST",
      body: { toUserId: b.id },
      idempotencyKey: key("play"),
    });
    const startedInvite = await call(b.session, `/api/v1/pvp/challenges/${challenge.json.data.challengeId}/respond`, {
      method: "POST",
      body: { accept: true },
    });
    const playingId = startedInvite.json.data.matchId;
    assert.equal((await call(a.session, `/api/v1/pvp/matches/${playingId}/ready`, { method: "POST", body: {} })).status, 200);
    const started = await call(b.session, `/api/v1/pvp/matches/${playingId}/ready`, { method: "POST", body: {} });
    assert.equal(started.status, 200);
    assert.equal(started.json.data.started, true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const holdA = await call(a.session, `/api/v1/pvp/matches/${playingId}/actions`, {
      method: "POST",
      body: { round: 1, action: "hold" },
      idempotencyKey: key("hold-a"),
    });
    assert.equal(holdA.status, 200, JSON.stringify(holdA.json));
    const mine = await call(a.session, `/api/v1/pvp/matches/${playingId}`);
    assert.equal(mine.json.data.me.lockedToday, true);
    assert.equal(mine.json.data.me.lockedAction, "hold");
    assert.equal(mine.json.data.opponent.lockedToday, false);
    assert.equal(mine.json.data.opponent.lockedAction, undefined);
    assert.equal(mine.json.data.opponent.userId, b.id);
    const holdB = await call(b.session, `/api/v1/pvp/matches/${playingId}/actions`, {
      method: "POST",
      body: { round: 1, action: "hold" },
      idempotencyKey: key("hold-b"),
    });
    assert.equal(holdB.status, 200, JSON.stringify(holdB.json));
    const revealed = await call(a.session, `/api/v1/pvp/matches/${playingId}`);
    const snap = JSON.parse(openDb().prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(playingId).snapshot_json);
    assert.equal(revealed.json.data.resolvedRounds, 1);
    assert.equal(revealed.json.data.market.history[0].label, "h1");
    assert.equal(revealed.json.data.market.bars[0].label, "d1");
    assert.equal(revealed.json.data.market.bars[1].label, "d2");
    assert.equal(revealed.json.data.identity, undefined);
    assert.equal(JSON.stringify(revealed.json.data).includes(snap.stockCode), false);
    assert.equal(JSON.stringify(revealed.json.data).includes(snap.stockName), false);

    const stranger = sessionFor("stranger");
    const peek = await call(stranger.session, `/api/v1/pvp/matches/${playingId}`);
    assert.equal(peek.status, 404);
    assert.equal(JSON.stringify(peek.json).includes(snap.stockCode), false);

    const forfeited = await call(a.session, `/api/v1/pvp/matches/${playingId}/forfeit`, {
      method: "POST",
      body: {},
      idempotencyKey: key("forfeit"),
    });
    assert.equal(forfeited.status, 200, JSON.stringify(forfeited.json));
    const ended = await call(a.session, `/api/v1/pvp/matches/${playingId}`);
    assert.equal(ended.json.data.terminal.reason, "forfeit");
    assert.equal(ended.json.data.me.outcome, "loss");
    assert.equal(ended.json.data.me.coinDelta, -20);
    assert.equal(ended.json.data.identity, undefined);
    assert.equal(JSON.stringify(ended.json.data).includes(snap.stockCode), false);
    const history = await call(a.session, "/api/v1/me/pvp/matches?limit=20");
    const entry = history.json.data.entries.find((item) => item.matchId === playingId);
    assert.ok(entry);
    assert.equal(entry.terminalReason, "forfeit");
    assert.equal(entry.stockCode, undefined);
    assert.equal(JSON.stringify(entry).includes(snap.stockCode), false);

    const visible = sessionFor("flag");
    assert.equal((await call(visible.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: true },
    })).status, 200);
    config.pvpBattleEnabled = false;
    const hidden = await call(null, "/api/v1/pvp/lobby/summary");
    assert.equal(hidden.json.data.availableCount, 0);
    assert.equal(hidden.json.data.acceptingNew, false);
    assert.equal(hidden.json.data.disabledReason, "对战未开放");
    const blocked = await call(visible.session, "/api/v1/pvp/lobby/presence", {
      method: "POST",
      body: { available: false },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, "FEATURE_DISABLED");
  } finally {
    config.pvpBattleEnabled = false;
    clearPresence();
    await http.stop();
    closeDb();
  }
});

