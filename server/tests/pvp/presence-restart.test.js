import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { clearPresence } = await import("../../src/lib/pvp/presence.js");
const { createSession } = await import("../../src/lib/sessions.js");
const { startTestServer } = await import("../helpers.js");

config.pvpBattleEnabled = true;
migrate();
const http = await startTestServer();

test.after(async () => {
  clearPresence();
  await http.stop();
  closeDb();
});

async function call(session, pathname, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json", Origin: "http://127.0.0.1" };
  if (session) {
    headers.Cookie = `${config.cookieName}=${session.sessionToken}`;
    if (method !== "GET") headers["X-CSRF-Token"] = session.csrfToken;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${http.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test("heartbeat tells a client the server forgot its presence (API restart); re-announcing restores it", async () => {
  const id = seedUser(openDb(), { name: `beat-${crypto.randomUUID()}` });
  const session = createSession(id);
  // After a restart nobody is registered: the beat must say so instead of silently succeeding.
  clearPresence();
  const lost = await call(session, "/api/v1/pvp/heartbeat", { method: "POST", body: {} });
  assert.equal(lost.status, 200);
  assert.equal(lost.json.data.presence, false);
  assert.equal((await call(null, "/api/v1/pvp/lobby/summary")).json.data.availableCount, 0);
  // The client (js/pvp/lobby.js) re-announces on that signal.
  assert.equal((await call(session, "/api/v1/pvp/lobby/presence", { method: "POST", body: { available: true } })).status, 200);
  const kept = await call(session, "/api/v1/pvp/heartbeat", { method: "POST", body: {} });
  assert.equal(kept.json.data.presence, true);
  assert.equal((await call(null, "/api/v1/pvp/lobby/summary")).json.data.availableCount, 1);
});
