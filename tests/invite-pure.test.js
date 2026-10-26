import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInviteCode, parseInviteFromSearch, stripInviteFromUrl, buildInviteLink,
  readPendingInvite, writePendingInvite, clearPendingInvite, INVITE_TTL_MS, INVITE_STORAGE_KEY,
  registerNote, registerToast, rewardToast, statsLine, earnedLine, ruleLines, shareText, posterFooter,
} from "../js/invite-pure.js";

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("normalize: case, spaces, dashes, bad alphabet", () => {
  assert.equal(normalizeInviteCode(" abc-234 "), "ABC234");
  assert.equal(normalizeInviteCode("ABC23"), null);
  assert.equal(normalizeInviteCode("ABCDE0"), null);
  assert.equal(normalizeInviteCode("ABCDEI"), null);
  assert.equal(normalizeInviteCode(undefined), null);
});

test("URL: parse + strip keeps other params and hash", () => {
  assert.equal(parseInviteFromSearch("?invite=abc234"), "ABC234");
  assert.equal(parseInviteFromSearch("?x=1"), null);
  assert.equal(parseInviteFromSearch("?invite=<script>"), null);
  assert.equal(stripInviteFromUrl("/", "?invite=ABC234", "#/pvp"), "/#/pvp");
  assert.equal(stripInviteFromUrl("/", "?a=1&invite=ABC234&b=2", ""), "/?a=1&b=2");
});

test("link: valid code appended, invalid falls back to bare origin", () => {
  assert.equal(buildInviteLink("abc234"), "https://stockgame.xieyw.top/?invite=ABC234");
  assert.equal(buildInviteLink("nope"), "https://stockgame.xieyw.top");
  assert.equal(buildInviteLink("ABC234", "http://localhost:8000/"), "http://localhost:8000/?invite=ABC234");
});

test("storage: round trip, expiry, garbage, clear", () => {
  const s = memStore();
  assert.equal(readPendingInvite(s), null);
  assert.equal(writePendingInvite(s, "abc234", 1000), true);
  assert.equal(readPendingInvite(s, 1000 + 5), "ABC234");
  assert.equal(readPendingInvite(s, 1000 + INVITE_TTL_MS + 1), null);
  s.setItem(INVITE_STORAGE_KEY, "{not json");
  assert.equal(readPendingInvite(s), null);
  assert.equal(writePendingInvite(s, "bad", 1), false);
  writePendingInvite(s, "abc234");
  clearPendingInvite(s);
  assert.equal(readPendingInvite(s), null);
  // a storage that throws must not break anything
  const boom = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.equal(readPendingInvite(boom), null);
  assert.equal(writePendingInvite(boom, "ABC234"), false);
  clearPendingInvite(boom);
});

test("copy: register note / toasts", () => {
  assert.match(registerNote("abc234"), /ABC234.*\+80/);
  assert.equal(registerNote("bad"), "");
  assert.equal(registerToast({ accepted: false }), "");
  assert.equal(registerToast(null), "");
  assert.match(registerToast({ accepted: true, inviteeCoins: 80 }), /\+80/);
  assert.equal(rewardToast(null), "");
  assert.equal(rewardToast({ inviteeCoins: 0 }), "");
  assert.match(rewardToast({ inviteeCoins: 80, inviterCoins: 100 }), /\+80/);
});

test("stats / rules lines", () => {
  assert.equal(statsLine({ stats: { invited: 0 } }), "还没有人使用你的邀请码");
  assert.equal(statsLine({ stats: { invited: 3, rewarded: 2, pending: 1 } }), "已邀请 3 人 · 2 人已完成首局 · 1 人待完成");
  assert.equal(statsLine({ stats: { invited: 2, rewarded: 2, pending: 0 } }), "已邀请 2 人 · 2 人已完成首局");
  assert.equal(earnedLine({ stats: { coinsEarned: 200 }, remaining: 18 }), "累计获得 200 韭币 · 还可奖励 18 位好友");
  const rules = ruleLines({ inviterCoins: 100, inviteeCoins: 80, dailyCap: 5, maxRewards: 20 });
  assert.equal(rules.length, 3);
  assert.match(rules[1], /100.*80/);
  assert.match(rules[2], /5.*20/);
});

test("share text carries code and link", () => {
  const t = shareText("ABC234", "https://stockgame.xieyw.top/?invite=ABC234");
  assert.match(t, /ABC234/);
  assert.match(t, /https:\/\/stockgame\.xieyw\.top\/\?invite=ABC234$/);
});

test("poster footer: invited vs plain", () => {
  const withCode = posterFooter({ enabled: true, code: "abc234" });
  assert.equal(withCode.code, "ABC234");
  assert.equal(withCode.link, "https://stockgame.xieyw.top/?invite=ABC234");
  assert.match(withCode.line2, /ABC234/);
  for (const bad of [null, undefined, { enabled: false, code: "ABC234" }, { enabled: true, code: "x" }]) {
    const plain = posterFooter(bad);
    assert.equal(plain.code, null);
    assert.equal(plain.link, "https://stockgame.xieyw.top");
  }
});
