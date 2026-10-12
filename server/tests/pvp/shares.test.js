import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareTestEnv } from "../helpers.js";
import { NOW, balanceOf, seedUser } from "./fixture.js";

prepareTestEnv();

const { openDb, closeDb } = await import("../../src/db/connection.js");
const { migrate } = await import("../../src/db/migrate.js");
const { config } = await import("../../src/lib/config.js");
const { acceptChallenge, createChallenge } = await import("../../src/lib/pvp/challenges.js");
const { SHARE_MS, READY_MS } = await import("../../src/lib/pvp/config.js");
const { blockUser } = await import("../../src/lib/pvp/eligibility.js");
const { createShareLink, joinShareLink } = await import("../../src/lib/pvp/shares.js");

config.pvpBattleEnabled = true;

migrate();
const db = openDb();
let keyN = 0;

test.after(() => closeDb());

function key(label) {
  keyN += 1;
  return `key-${label}-${keyN}-0123456789abcdef`;
}

function user(label, extra = {}) {
  return seedUser(db, { name: `${label}-${crypto.randomUUID()}`, ...extra });
}

test("a share link seats both players in waiting_ready without charging", () => {
  const host = user("host");
  const friend = user("friend", { createdAt: new Date(NOW - 60 * 1000).toISOString() });
  const first = createShareLink(db, { userId: host, now: NOW });
  const again = createShareLink(db, { userId: host, now: NOW + 1000 });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(again.replay, true);
  assert.equal(again.code, first.code);
  assert.match(first.code, /^[a-z2-9]{8}$/);

  const joined = joinShareLink(db, { code: first.code, userId: friend, now: NOW + 2000 });
  assert.equal(joined.ok, true);
  assert.equal(
    db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(joined.matchId).status,
    "waiting_ready",
  );
  assert.equal(
    db.prepare(`SELECT ready_deadline_at - created_at AS gap FROM pvp_matches WHERE id = ?`).get(joined.matchId).gap,
    READY_MS,
  );
  const seats = db.prepare(`SELECT user_id, seat FROM pvp_match_players WHERE match_id = ? ORDER BY seat`).all(joined.matchId);
  assert.deepEqual(seats.map((row) => row.user_id), [host, friend]);
  assert.equal(balanceOf(db, host), 500);
  assert.equal(balanceOf(db, friend), 500);
  assert.equal(db.prepare(`SELECT status FROM pvp_share_links WHERE code = ?`).get(first.code).status, "joined");

  const replay = joinShareLink(db, { code: first.code.toUpperCase(), userId: friend, now: NOW + 3000 });
  assert.equal(replay.replay, true);
  assert.equal(replay.matchId, joined.matchId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE id = ?`).get(joined.matchId).c, 1);
});

test("share join rejects self, a second friend, expiry, blocks, and a full room", () => {
  const host = user("gate-host");
  const friend = user("gate-friend");
  const other = user("gate-other");
  const link = createShareLink(db, { userId: host, now: NOW });
  assert.equal(joinShareLink(db, { code: link.code, userId: host, now: NOW }).code, "SELF_CHALLENGE");
  assert.equal(joinShareLink(db, { code: "nope", userId: friend, now: NOW }).code, "NOT_FOUND");

  const outbound = createChallenge(db, { fromUserId: host, toUserId: other, createKey: key("out"), now: NOW });
  assert.equal(outbound.ok, true);
  const joined = joinShareLink(db, { code: link.code, userId: friend, now: NOW + 1000 });
  assert.equal(joined.ok, true);
  assert.equal(db.prepare(`SELECT status FROM pvp_challenges WHERE id = ?`).get(outbound.challenge.id).status, "cancelled");
  assert.equal(joinShareLink(db, { code: link.code, userId: other, now: NOW + 2000 }).code, "SHARE_CLOSED");

  const stale = createShareLink(db, { userId: user("stale"), now: NOW });
  assert.equal(
    joinShareLink(db, { code: stale.code, userId: friend, now: NOW + SHARE_MS }).code,
    "SHARE_CLOSED",
  );

  const blockedHost = user("blocked-host");
  const blockedFriend = user("blocked-friend");
  const blockedLink = createShareLink(db, { userId: blockedHost, now: NOW });
  blockUser(db, blockedHost, blockedFriend, NOW);
  assert.equal(joinShareLink(db, { code: blockedLink.code, userId: blockedFriend, now: NOW }).code, "BLOCKED");

  const busyHost = user("busy-host");
  const busyMate = user("busy-mate");
  const busyJoiner = user("busy-joiner");
  const busyLink = createShareLink(db, { userId: busyHost, now: NOW });
  const held = createChallenge(db, { fromUserId: busyHost, toUserId: busyMate, createKey: key("busy"), now: NOW });
  assert.equal(acceptChallenge(db, { challengeId: held.challenge.id, userId: busyMate, now: NOW }).ok, true);
  assert.equal(joinShareLink(db, { code: busyLink.code, userId: busyJoiner, now: NOW }).code, "TARGET_BUSY");
  assert.equal(db.prepare(`SELECT status FROM pvp_share_links WHERE code = ?`).get(busyLink.code).status, "open");
});

test("a full room does not keep a half-written share challenge", () => {
  const joiner = user("full-joiner");
  const freshHost = user("fresh-host");
  const freshLink = createShareLink(db, { userId: freshHost, now: NOW });
  const previous = config.pvpMaxActiveMatches;
  config.pvpMaxActiveMatches = db.prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`).get().c;
  try {
    const denied = joinShareLink(db, { code: freshLink.code, userId: joiner, now: NOW });
    assert.equal(denied.code, "CAPACITY");
    const row = db.prepare(`SELECT status, match_id FROM pvp_share_links WHERE code = ?`).get(freshLink.code);
    assert.equal(row.status, "open");
    assert.equal(row.match_id, null);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM pvp_challenges WHERE from_user_id = ?`).get(freshHost).c, 0);
  } finally {
    config.pvpMaxActiveMatches = previous;
  }
});

test("a one-minute-old account can share and join", () => {
  const fresh = user("minute", { createdAt: new Date(NOW - 60 * 1000).toISOString() });
  const other = user("minute-other");
  const link = createShareLink(db, { userId: fresh, now: NOW });
  assert.equal(link.ok, true);
  const joined = joinShareLink(db, { code: link.code, userId: other, now: NOW });
  assert.equal(joined.ok, true);
  assert.equal(createShareLink(db, { userId: user("noclass", { classics: 0 }), now: NOW }).code, "NOT_ELIGIBLE");
});
