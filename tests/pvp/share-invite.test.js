import test from "node:test";
import assert from "node:assert/strict";
import { buildBattleInviteUrl, buildBattleSharePayload, PVP_INVITE_SHARE_TEXT } from "../../js/pvp/copy.js";

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
  assert.equal(payload.text, PVP_INVITE_SHARE_TEXT);
  assert.equal(payload.clipboard, `${payload.text}\n${payload.url}`);
  assert.doesNotMatch(payload.clipboard, /#\/pvp\/join\//);
});

test("invite.html link-preview descriptions match PVP_INVITE_SHARE_TEXT", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../invite.html", import.meta.url), "utf8");
  const get = (re) => (html.match(re) || [])[1];
  for (const re of [
    /<meta\s+name="description"\s+content="([^"]*)"/,
    /<meta\s+property="og:description"\s+content="([^"]*)"/,
    /<meta\s+name="twitter:description"\s+content="([^"]*)"/,
  ]) assert.equal(get(re), PVP_INVITE_SHARE_TEXT, String(re));
  // No JS-SDK share config today; if one is added, its desc must use the same text.
  for (const m of html.matchAll(/\bdesc\s*:\s*["'`]([^"'`]*)["'`]/g)) assert.equal(m[1], PVP_INVITE_SHARE_TEXT);
});

test("发给微信好友 is app-only: needs the shell bridge and an installed WeChat", async () => {
  const { canSendToWeChat } = await import("../../js/pvp/invite-share.js");
  assert.equal(canSendToWeChat({}), false);
  assert.equal(canSendToWeChat({ StockGameApp: { saveImage() {} } }), false);
  assert.equal(canSendToWeChat({ StockGameApp: { shareImageToWeChat() {}, canShareToWeChat: () => true } }), true);
  assert.equal(canSendToWeChat({ StockGameApp: { shareImageToWeChat() {}, canShareToWeChat: () => false } }), false);
  assert.equal(canSendToWeChat({ StockGameApp: { shareImageToWeChat() {}, canShareToWeChat: () => { throw new Error("x"); } } }), false);
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /id="pvpShareWeChatBtn"[^>]*hidden/);
});

test("Android shell sends the invite image straight to WeChat ShareImgUI with a chooser fallback", async () => {
  const { readFile } = await import("node:fs/promises");
  const kt = await readFile(new URL("../../android-app/app/src/main/java/top/xieyw/stockgame/MainActivity.kt", import.meta.url), "utf8");
  assert.match(kt, /fun shareImageToWeChat\(base64: String\?, fileName: String\?\): String/);
  assert.match(kt, /"com\.tencent\.mm\.ui\.tools\.ShareImgUI"/);
  assert.match(kt, /type = "image\/png"/);
  assert.match(kt, /FileProvider\.getUriForFile/);
  assert.match(kt, /launchChooser\(uri, "发给微信好友"\)/);
  const manifest = await readFile(new URL("../../android-app/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  assert.match(manifest, /<queries>\s*<package android:name="com\.tencent\.mm" \/>\s*<\/queries>/);
  const gradle = await readFile(new URL("../../android-app/app/build.gradle.kts", import.meta.url), "utf8");
  assert.match(gradle, /versionCode = 21/);
  assert.match(gradle, /versionName = "1\.1\.6"/);
});
