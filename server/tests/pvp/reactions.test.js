import test from "node:test";
import assert from "node:assert/strict";
import { listIncoming, resetReactions, sendReaction } from "../../src/lib/pvp/reactions.js";

function dbFor(status = "settled", nickname = "验收乙") {
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("FROM pvp_matches")) return { status };
          if (sql.includes("FROM users")) return { nickname, status: "active" };
          return undefined;
        },
        all() {
          if (sql.includes("pvp_match_players")) return [{ user_id: 1 }, { user_id: 2 }];
          return [];
        },
      };
    },
  };
}

test("a settled match can send a gift only to the other seat", () => {
  resetReactions();
  const db = dbFor();
  const sent = sendReaction(db, { matchId: "m1", fromUserId: 1, kind: "flower", now: 1_000 });
  assert.equal(sent.ok, true);
  assert.equal(sent.event.kind, "flower");
  const mine = listIncoming(1, 0, 1_000);
  assert.equal(mine.events.length, 0);
  const theirs = listIncoming(2, 0, 1_000);
  assert.equal(theirs.events.length, 1);
  assert.equal(theirs.events[0].nickname, "验收乙");
  assert.equal(theirs.events[0].kind, "flower");
  const again = listIncoming(2, theirs.events[0].id, 1_000);
  assert.equal(again.events.length, 0);
});

test("gifts wait until the match is over, and a fast second send is refused", () => {
  resetReactions();
  const playing = sendReaction(dbFor("playing"), { matchId: "m2", fromUserId: 1, kind: "tomato", now: 5_000 });
  assert.equal(playing.ok, false);
  assert.equal(playing.status, 409);
  const db = dbFor();
  assert.equal(sendReaction(db, { matchId: "m2", fromUserId: 1, kind: "pipe", now: 5_000 }).ok, true);
  const fast = sendReaction(db, { matchId: "m2", fromUserId: 1, kind: "tomato", now: 5_400 });
  assert.equal(fast.ok, false);
  assert.equal(fast.status, 429);
  assert.equal(sendReaction(db, { matchId: "m2", fromUserId: 1, kind: "coffee", now: 8_000 }).ok, true);
  const stranger = sendReaction(db, { matchId: "m2", fromUserId: 9, kind: "flower", now: 8_000 });
  assert.equal(stranger.status, 404);
  const unknown = sendReaction(db, { matchId: "m2", fromUserId: 1, kind: "coin", now: 8_000 });
  assert.equal(unknown.status, 400);
});
