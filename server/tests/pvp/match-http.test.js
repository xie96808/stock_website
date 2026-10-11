import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { NOW, balanceOf, pvpLedger, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { acceptChallenge, createChallenge, markReady } = await import("../../src/lib/pvp/challenges.js");
const { createSession } = await import("../../src/lib/sessions.js");
const { pvpRecoveryError, runBootRecovery, setRecoveryGuard } = await import("../../src/lib/pvp/recovery.js");
const { startTestServer } = await import("../helpers.js");

config.pvpBattleEnabled = true;
migrate();
const db = openDb();
let keyN = 0;

test.after(() => closeDb());

function key(label) {
  keyN += 1;
  return `http-${label}-${keyN}-0123456789abcdef`;
}

function startMatch() {
  const a = seedUser(db, { name: `http-a-${crypto.randomUUID()}` });
  const b = seedUser(db, { name: `http-b-${crypto.randomUUID()}` });
  const created = createChallenge(db, { fromUserId: a, toUserId: b, createKey: key("c"), now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created));
  const accepted = acceptChallenge(db, { challengeId: created.challenge.id, userId: b, now: NOW });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(markReady(db, { matchId: accepted.matchId, userId: a, now: NOW + 1 }).waiting, true);
  const started = markReady(db, { matchId: accepted.matchId, userId: b, now: NOW + 2 });
  assert.equal(started.started, true, JSON.stringify(started));
  const snap = JSON.parse(db.prepare(`SELECT snapshot_json FROM pvp_matches WHERE id = ?`).get(accepted.matchId).snapshot_json);
  return { a, b, matchId: accepted.matchId, stockCode: snap.stockCode, stockName: snap.stockName };
}

test("S04 A02 boot recovery hides the entry, and strangers cannot read a match", async () => {
  const seeded = startMatch();
  config.pvpBattleEnabled = false;
  const http = await startTestServer();
  try {
    const live = openDb();
    const row = live.prepare(`SELECT status, terminal_reason FROM pvp_matches WHERE id = ?`).get(seeded.matchId);
    assert.equal(row.status, "aborted");
    assert.equal(row.terminal_reason, "boot_recovery");
    assert.equal(balanceOf(live, seeded.a), 500);
    assert.equal(balanceOf(live, seeded.b), 500);
    assert.equal(pvpLedger(live, seeded.matchId).filter((item) => item.reason === "pvp_refund").length, 2);

    const session = createSession(seeded.a);
    const mine = await http.api(`/api/v1/pvp/matches/${seeded.matchId}`, {
      headers: { Cookie: `${config.cookieName}=${session.sessionToken}` },
    });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.data.identity, undefined);
    assert.equal(JSON.stringify(mine.json.data).includes(seeded.stockCode), false);
    assert.equal(JSON.stringify(mine.json.data).includes(seeded.stockName), false);
    assert.equal(mine.json.data.opponent.userId, undefined);

    const stranger = await http.register(`pvp${Date.now().toString(36)}`.slice(0, 20));
    const peek = await http.api(`/api/v1/pvp/matches/${seeded.matchId}`);
    assert.equal(peek.status, 404);
    assert.equal(JSON.stringify(peek.json).includes(seeded.stockCode), false);

    const challenge = await http.api("/api/v1/pvp/challenges", {
      method: "POST",
      csrf: stranger.csrfToken,
      body: { toUserId: seeded.b },
      headers: { "Idempotency-Key": key("off") },
    });
    assert.equal(challenge.status, 403);
    assert.equal(challenge.json.error.code, "FEATURE_DISABLED");

    const ready = await http.api("/api/v1/health/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.json.data.features.pvpBattle, false);

    const unknown = await http.api(`/api/v1/pvp/matches/${seeded.matchId}/actions`, {
      method: "POST",
      csrf: stranger.csrfToken,
      body: { round: 1, action: "hold", price: 12.5 },
      headers: { "Idempotency-Key": key("extra") },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.error.code, "BAD_PAYLOAD");
    assert.equal(JSON.stringify(unknown.json).includes("price"), false);

    const huge = await fetch(`${http.base}/api/v1/pvp/matches/${seeded.matchId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round: 1, action: "hold", pad: "x".repeat(70_000) }),
    });
    const hugeJson = await huge.json();
    assert.equal(huge.status, 413);
    assert.equal(hugeJson.error.code, "PAYLOAD_TOO_LARGE");

    setRecoveryGuard(() => {
      throw new Error("boom");
    });
    try {
      assert.throws(() => runBootRecovery(openDb()), /boom/);
      const down = await http.api("/api/v1/health/ready");
      assert.equal(down.status, 503);
      assert.equal(down.json.error.code, "NOT_READY");
    } finally {
      setRecoveryGuard(null);
    }
    runBootRecovery(openDb());
    assert.equal(pvpRecoveryError(), null);
    const up = await http.api("/api/v1/health/ready");
    assert.equal(up.status, 200);
    assert.equal(pvpLedger(openDb(), seeded.matchId).filter((item) => item.reason === "pvp_refund").length, 2);
  } finally {
    config.pvpBattleEnabled = true;
    setRecoveryGuard(null);
    await http.stop();
  }
});
