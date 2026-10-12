import test from "node:test";
import assert from "node:assert/strict";
import { buildBattleInviteUrl, buildBattleSharePayload } from "../../js/pvp/copy.js";

test("battle invite URL is path-based for link-card crawlers", () => {
  assert.equal(
    buildBattleInviteUrl("ab3defgh", "https://stockgame.xieyw.top"),
    "https://stockgame.xieyw.top/invite.html?c=ab3defgh",
  );
  assert.equal(
    buildBattleInviteUrl("AB3DEFGH", "https://stockgame.xieyw.top/"),
    "https://stockgame.xieyw.top/invite.html?c=ab3defgh",
  );
  assert.equal(buildBattleInviteUrl("short", "https://stockgame.xieyw.top"), "");
  assert.equal(buildBattleInviteUrl("#########", "https://stockgame.xieyw.top"), "");
});

test("battle share payload keeps a short clipboard line plus the invite URL", () => {
  const payload = buildBattleSharePayload("ab3defgh", "https://stockgame.xieyw.top");
  assert.equal(payload.url, "https://stockgame.xieyw.top/invite.html?c=ab3defgh");
  assert.match(payload.title, /早知道当初不炒了/);
  assert.match(payload.text, /进房间/);
  assert.equal(payload.clipboard, `${payload.text}\n${payload.url}`);
  assert.doesNotMatch(payload.clipboard, /#\/pvp\/join\//);
});
