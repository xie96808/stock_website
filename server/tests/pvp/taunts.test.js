import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TAUNT_CODEPOINTS, resetTaunts, sendTaunt, TAUNT_LINES } from "../../src/lib/pvp/taunts.js";

function dbFor(status = "playing", nickname = "嘲讽甲") {
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

test("playing match accepts preset and short custom taunts, then rate-limits", () => {
  resetTaunts();
  const db = dbFor();
  const sent = sendTaunt(db, { matchId: "m1", fromUserId: 1, text: TAUNT_LINES[0], now: 1_000 });
  assert.equal(sent.ok, true);
  assert.equal(sent.event.text, TAUNT_LINES[0]);
  assert.deepEqual(sent.userIds, [1, 2]);
  const fast = sendTaunt(db, { matchId: "m1", fromUserId: 1, text: TAUNT_LINES[1], now: 1_500 });
  assert.equal(fast.ok, false);
  assert.equal(fast.status, 429);
  const next = sendTaunt(db, { matchId: "m1", fromUserId: 1, text: TAUNT_LINES[2], now: 4_000 });
  assert.equal(next.ok, true);
  const settled = sendTaunt(dbFor("settled"), { matchId: "m2", fromUserId: 1, text: TAUNT_LINES[0], now: 5_000 });
  assert.equal(settled.ok, false);
  assert.equal(settled.status, 409);
  const custom = sendTaunt(db, { matchId: "m1", fromUserId: 1, text: "  我先观望一下  ", now: 8_000 });
  assert.equal(custom.ok, true);
  assert.equal(custom.event.text, "我先观望一下");
  assert.equal(custom.event.isCustom, true);
  const preset = sendTaunt(db, { matchId: "m1", fromUserId: 2, text: TAUNT_LINES[0], now: 8_000 });
  assert.equal(preset.event.isCustom, false);
  const stranger = sendTaunt(db, { matchId: "m1", fromUserId: 9, text: TAUNT_LINES[0], now: 12_000 });
  assert.equal(stranger.status, 404);
});

test("custom taunts enforce codepoint length and reject empty/control text", () => {
  resetTaunts();
  const db = dbFor();
  const atLimit = "字".repeat(MAX_TAUNT_CODEPOINTS);
  assert.equal(sendTaunt(db, { matchId: "m1", fromUserId: 1, text: atLimit, now: 10_000 }).ok, true);
  const emojiAtLimit = "🙂".repeat(MAX_TAUNT_CODEPOINTS);
  assert.equal(sendTaunt(db, { matchId: "m1", fromUserId: 2, text: emojiAtLimit, now: 10_000 }).ok, true);
  assert.equal(sendTaunt(db, { matchId: "m2", fromUserId: 1, text: "字".repeat(MAX_TAUNT_CODEPOINTS + 1), now: 14_000 }).status, 400);
  assert.equal(sendTaunt(db, { matchId: "m3", fromUserId: 1, text: "   ", now: 14_000 }).status, 400);
  assert.equal(sendTaunt(db, { matchId: "m4", fromUserId: 1, text: "你好\n世界", now: 14_000 }).status, 400);
  assert.equal(sendTaunt(db, { matchId: "m5", fromUserId: 1, text: "你好\u0000世界", now: 14_000 }).status, 400);
});

test("seed taunt lines stay exact", () => {
  assert.deepEqual([...TAUNT_LINES], [
    "这你都买？进厂打螺丝吧",
    "这都卖？啥都拿不住玩什么股票！",
    "买买买",
    "割了割了",
    "给我加仓猛干！",
    "技术回调，慌个锤子",
  ]);
});
