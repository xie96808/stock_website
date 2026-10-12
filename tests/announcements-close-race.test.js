import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../js/announcements.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/announcements.css", import.meta.url), "utf8");

test("announcement close honours pointerdown target during enter anim", () => {
  assert.match(js, /addEventListener\(\s*"pointerdown"/);
  assert.match(js, /downAction/);
  assert.match(js, /actionAt\(e\.clientX, e\.clientY/);
});

test("close cancels an in-flight async open", () => {
  assert.match(js, /openSeq \+= 1/);
  assert.match(js, /if \(seq !== openSeq\) return items;/);
});

test("leaving overlay absorbs rapid repeat taps", () => {
  assert.match(css, /\.announcements-modal\.is-leaving\s*\{\s*pointer-events:\s*auto !important;/);
});
