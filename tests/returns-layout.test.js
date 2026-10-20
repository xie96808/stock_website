import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveReturnsLayout, toneOf, DEFAULT_RETURNS_LAYOUT } from "../js/returns-layout.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("returns layout: ?rl wins, then stored choice, then default A", () => {
  assert.equal(DEFAULT_RETURNS_LAYOUT, "a");
  assert.equal(resolveReturnsLayout("", null), "a");
  assert.equal(resolveReturnsLayout("?rl=b", "a"), "b");
  assert.equal(resolveReturnsLayout("?rl=OFF", "b"), "off");
  assert.equal(resolveReturnsLayout("", "b"), "b");
  assert.equal(resolveReturnsLayout("?rl=zzz", "nope"), "a");
  assert.equal(resolveReturnsLayout("?x=1", "off"), "off");
});

test("returns layout: tone follows the board node (red up / green down via positive/negative)", () => {
  assert.equal(toneOf("metric-value positive"), "positive");
  assert.equal(toneOf("metric-value negative"), "negative");
  assert.equal(toneOf("board-chip locked"), "locked");
  assert.equal(toneOf("metric-value neutral"), "neutral");
  assert.equal(toneOf("meta-value"), "neutral");
  assert.equal(toneOf("nonpositive"), "neutral");
});

test("returns layout: mirrors the existing total-return / position / daily nodes", () => {
  const js = read("js/returns-layout.js");
  assert.match(js, /mirror\(document\.getElementById\("holdingPnl"\)/);
  assert.match(js, /mirror\(document\.getElementById\("positionStatus"\)[^;]*chip: true/);
  assert.match(js, /mirror\(document\.getElementById\("dailyReturn"\)/);
  assert.match(js, /mood\.after\(card\)/, "option A sits where 「市场在等待你的判断…」 was");
  assert.match(js, /zone\.prepend\(strip\)/, "option B sits on top of the trade bar");
  assert.match(js, /persist: explicit/, "only an explicit ?rl choice is remembered");
  const game = read("js/game.js");
  assert.match(game, /import \{ initReturnsLayout \} from '\.\/returns-layout\.js';/);
  assert.match(game, /initActionZoneSync\(\);\s*\n\s*initReturnsLayout\(\);/);
});

test("returns layout CSS: phone-only, trade buttons untouched, positive red / negative green", () => {
  const css = read("css/game.css");
  const start = css.indexOf("===== Phone: key return figures on the first screen");
  assert.ok(start > 0);
  const block = css.slice(start);
  assert.match(block, /^\.rl-card, \.rl-strip, \.rl-info \{ display: none; \}$/m, "hidden on desktop by default");
  assert.match(block, /^\.rl-hint-row \{ display: contents; \}$/m, "hint wrapper is inert when off");
  const media = block.indexOf("@media (max-width: 900px)");
  assert.ok(media > 0);
  const rules = block.slice(media);
  assert.doesNotMatch(rules, /#(buyBtn|sellBtn|holdBtn)|\.action-btn(?!\.ff)|\.ctl-(buy|sell|hold)/, "buy/sell/hold sizes are not changed");
  assert.match(rules, /\.rl-v\.positive \{ color: var\(--gain-color\); \}/);
  assert.match(rules, /\.rl-v\.negative \{ color: var\(--loss-color\); \}/);
  assert.match(rules, /html\[data-returns-layout="a"\] #gameScreen #progressMood \{ display: none; \}/);
  assert.match(rules, /:not\(\.rl-hints-open\) #gameScreen \.action-zone \.ff-hint \{ display: none; \}/);
});
