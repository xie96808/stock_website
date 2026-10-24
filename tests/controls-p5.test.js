import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const css = readFileSync(new URL("../css/controls-p5.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const academy = readFileSync(new URL("../css/academy.css", import.meta.url), "utf8");

test("P5 stylesheet wired after P4", () => {
  assert.ok(html.indexOf("css/controls-p5.css") > html.indexOf("css/controls-p4.css"));
});

test("P5 assets referenced exist (1x + 2x webp)", () => {
  const names = [
    ...new Set([...css.matchAll(/controls\/(ctl-[a-z0-9-]+?)(?:@2x)?\.webp/g)].map((m) => m[1])),
  ];
  assert.ok(names.length >= 15, String(names.length));
  for (const n of names) {
    for (const s of ["", "@2x"]) {
      assert.ok(
        existsSync(new URL(`../assets/controls/${n}${s}.webp`, import.meta.url)),
        `${n}${s}`
      );
    }
  }
});

test("P5 covers icon/chart/popover/bar/option/seal/select/gift", () => {
  for (const needle of [
    "ctl-icon-btn",
    "ctl-chart-frame",
    "ctl-popover",
    "ctl-bar-strip",
    "ctl-option-row",
    "ctl-seal-ring",
    "ctl-select",
    "ctl-gift",
  ]) {
    assert.match(css, new RegExp(needle));
  }
  assert.match(css, /\.quiz-option\.correct[\s\S]*?--p5-opt-correct/);
  assert.match(css, /\.quiz-option\.wrong[\s\S]*?--p5-opt-wrong/);
  assert.match(css, /--p5-press-ms:\s*70ms/);
});

test("academy back bar clears fixed chrome at 1280", () => {
  // zones keep the header's own 52px clearance; the landing bar carries it via nav-back.css
  assert.match(academy, /\.academy-header\s*\{[\s\S]*?padding-top:\s*52px/);
  assert.match(html, /data-sg-back="academy"[\s\S]*?academy-header[\s\S]*?academy-heading/);
  const navCss = readFileSync(new URL("../css/nav-back.css", import.meta.url), "utf8");
  assert.match(navCss, /\.academy-screen > \.sg-backbar \{ margin-top: 56px; \}/);
});
