import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authJs = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
const feedbackCss = readFileSync(new URL("../css/feedback.css", import.meta.url), "utf8");
const authCss = readFileSync(new URL("../css/auth.css", import.meta.url), "utf8");
const profileBattle = readFileSync(new URL("../js/pvp/profile-battle.js", import.meta.url), "utf8");
const feedbackJs = readFileSync(new URL("../js/feedback.js", import.meta.url), "utf8");

test("settings UI drops leaderboard toggle and adds signature", () => {
  assert.equal(authJs.includes("settingsOptIn"), false);
  assert.equal(authJs.includes("参与排行榜"), false);
  assert.match(authJs, /id="settingsSignature"/);
  assert.match(authJs, /个性签名/);
  assert.match(authJs, /leaderboardOptIn:\s*true/);
});

test("avatar file inputs accept image/* for mobile gallery", () => {
  assert.match(authJs, /id="settingsAvatarFile"[^>]*accept="image\/\*"/);
  assert.match(authJs, /class="avatar-file-input"/);
  assert.match(authCss, /\.avatar-file-input/);
});

test("feedback modal sits above auth settings", () => {
  assert.match(feedbackCss, /z-index:\s*160/);
  assert.match(authCss, /z-index:\s*150/);
});

test("settings no longer injects 打开对战档案 button", () => {
  assert.equal(profileBattle.includes("打开对战档案"), false);
});

test("feedback escape uses capture so auth does not steal it", () => {
  assert.match(feedbackJs, /addEventListener\("keydown",[\s\S]*true\)/);
});
