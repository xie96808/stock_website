import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("P3 control assets ship in assets/controls", () => {
  const names = [
    "ctl-rank-card",
    ...["self", "opponent"].flatMap((s) => ["default", "active", "leading"].map((st) => `ctl-seat-panel-${s}-${st}`)),
    ...["track", "fill", "fill-segmented", "urgent"].map((k) => `ctl-timer-ring-${k}`),
    ...["default", "press", "loading", "disabled"].map((k) => `ctl-share-save-${k}`),
  ];
  for (const n of names) {
    for (const ext of [".png", ".webp", "@2x.png", "@2x.webp"]) {
      assert.ok(fs.existsSync(path.join(ROOT, "assets/controls", n + ext)), `${n}${ext}`);
    }
  }
});

test("PvP result: icon-only 保存分享图 sits right after 再次约战 with an aria-label", () => {
  const html = read("index.html");
  const again = html.indexOf('id="pvpResultAgain"');
  const save = html.indexOf('id="pvpResultShareImage"');
  assert.ok(again > 0 && save > again && save - again < 400);
  assert.match(html, /id="pvpResultShareImage"[^>]*aria-label="保存分享图"/);
});

test("timer rings + seat panels wired in the battle top bar", () => {
  const html = read("index.html");
  assert.match(html, /id="pvpReadyClock"[\s\S]{0,200}id="pvpReadyClockRing"/);
  assert.match(html, /id="pvpClock"[\s\S]{0,200}id="pvpClockRing"/);
  assert.match(html, /id="pvpClockNum">30</);
  assert.match(html, /class="pvp-seat pvp-seat-me ctl-seat-panel" id="pvpSeatMe"/);
  assert.match(html, /class="pvp-seat pvp-seat-opp ctl-seat-panel" id="pvpSeatOpp"/);
});

test("share-image uses local vendor html2canvas, bridge → navigator.share → download", () => {
  const src = read("js/share-image.js");
  assert.ok(!/cdn\.jsdelivr|https:\/\/unpkg/.test(src), "no CDN");
  assert.match(src, /import\("\.\/vendor\/html2canvas\.esm\.js"\)/);
  const bridge = src.indexOf("app.saveImage(");
  const share = src.indexOf("nav.share(");
  const download = src.indexOf("a.download = fileName");
  assert.ok(bridge > 0 && share > bridge && download > share);
  assert.ok(fs.existsSync(path.join(ROOT, "js/vendor/html2canvas.esm.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "js/vendor/qrcode.js")));
});

test("qrcode vendor module encodes the invite link", async () => {
  const { default: qrcode } = await import("../../js/vendor/qrcode.js");
  const qr = qrcode(0, "M");
  qr.addData("https://stockgame.xieyw.top/#/pvp");
  qr.make();
  assert.ok(qr.getModuleCount() >= 21);
});

test("Android bridge exposes saveImage + shareImage (MediaStore album, API<29 share fallback)", () => {
  const kt = read("android-app/app/src/main/java/top/xieyw/stockgame/MainActivity.kt");
  assert.match(kt, /fun saveImage\(base64: String\?, fileName: String\?\): String/);
  assert.match(kt, /fun shareImage\(/);
  assert.match(kt, /ALBUM_DIR = "早知道当初不炒了"/);
  assert.match(kt, /DIRECTORY_PICTURES/);
  assert.match(kt, /VERSION_CODES\.Q/);
  assert.match(read("android-app/app/src/main/res/xml/file_paths.xml"), /path="share\/"/);
});
