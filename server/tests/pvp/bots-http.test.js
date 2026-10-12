import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { ensureBotsSeeded, listBotUsers } = await import("../../src/lib/pvp/botUsers.js");
const { createSession } = await import("../../src/lib/sessions.js");
const { startTestServer } = await import("../helpers.js");

config.pvpBattleEnabled = true;
config.pvpBotsEnabled = true;
config.pvpMaxBotMatches = 3;
config.pvpHumanRoomReserve = 2;

migrate();
ensureBotsSeeded(openDb());
const http = await startTestServer();
let keyN = 0;

test.after(async () => {
  config.pvpBotsEnabled = false;
  await http.stop();

});

function key(label) {
  keyN += 1;
  return `both-${label}-${keyN}-0123456789abcdef`;
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

test("config features.pvpBots and lobby/challenge HTTP path", async () => {
  const features = await call(null, "/api/v1/config");
  assert.equal(features.status, 200);
  assert.equal(features.json.data.features.pvpBots, true);

  const player = sessionFor("http-bot");
  const bots = listBotUsers(openDb());
  assert.ok(bots.length >= 1);

  const lobby = await call(player.session, "/api/v1/pvp/lobby?limit=50");
  assert.equal(lobby.status, 200);
  const botEntries = (lobby.json.data.entries || []).filter((e) => e.isBot);
  assert.ok(botEntries.length >= 1);
  assert.ok(!JSON.stringify(botEntries).includes("机器人"));

  const challenged = await call(player.session, "/api/v1/pvp/challenges", {
    method: "POST",
    body: { toUserId: bots[0].id },
    idempotencyKey: key("c1"),
  });
  assert.equal(challenged.status, 201);
  assert.equal(challenged.json.data.autoAccepted, true);
  assert.ok(challenged.json.data.matchId);

  const state = await call(player.session, "/api/v1/me/pvp/state");
  assert.equal(state.json.data.activeMatchId, challenged.json.data.matchId);

  config.pvpBotsEnabled = false;
  const featuresOff = await call(null, "/api/v1/config");
  // config is read at request time from config object
  assert.equal(featuresOff.json.data.features.pvpBots, false);
  config.pvpBotsEnabled = true;
});
