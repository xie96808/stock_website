// M-02: invisible ::after hit-slop for small controls (visual size unchanged).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../css/controls-p5.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("/* M-02 · Tap-target hit-slop"));

test("each small control gets a transparent ::after hit area", () => {
  for (const sel of ["#announcementsBtn", "#jiuCoinDailyBtn", "#authLoginBtn", "#authUserBtn", ".ha-daily > button", ".auth-tab", "#dailyChallengeBoardBtn", ".sg-tut__btn", "#indicatorsToggle"]) {
    assert.ok(block.includes(sel + "::after"), sel);
  }
  assert.match(block, /content: "";\s*position: absolute;/);
  assert.match(block, /background: transparent;/);
});

test("controls that would overlap a neighbour are not extended toward it", () => {
  assert.doesNotMatch(block, /#rlHintToggle::after|#fastForwardBtn::after/);
  assert.match(block, /#authUserBtn \{[^}]*--hit-slop-right: 6px;/);
  assert.doesNotMatch(block, /#authUserBtn \{[^}]*--hit-slop-left/);
});
