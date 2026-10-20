import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toneOf, STALE_LAYOUT_KEY } from "../js/returns-layout.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("returns layout: tone follows the board node (red up / green down via positive/negative)", () => {
  assert.equal(toneOf("metric-value positive"), "positive");
  assert.equal(toneOf("metric-value negative"), "negative");
  assert.equal(toneOf("board-chip locked"), "locked");
  assert.equal(toneOf("metric-value neutral"), "neutral");
  assert.equal(toneOf("meta-value"), "neutral");
  assert.equal(toneOf("nonpositive"), "neutral");
});

test("returns layout: A only — no toggle, no strip, stale preview key removed", () => {
  const js = read("js/returns-layout.js");
  assert.equal(STALE_LAYOUT_KEY, "sg_returns_layout");
  assert.match(js, /localStorage\?\.removeItem\(STALE_LAYOUT_KEY\)/);
  assert.doesNotMatch(js, /localStorage\??\.setItem|URLSearchParams|dataset\.returnsLayout|rlStrip|"rl"/);
  assert.match(js, /mirror\(document\.getElementById\("holdingPnl"\), document\.getElementById\("rlCardPnl"\)\)/);
  assert.match(js, /mirror\(document\.getElementById\("positionStatus"\), document\.getElementById\("rlCardPos"\), \{ chip: true \}\)/);
  assert.match(js, /mirror\(document\.getElementById\("dailyReturn"\), document\.getElementById\("rlCardDaily"\)\)/);
  assert.match(js, /mood\.after\(card\)/, "card sits where 「市场在等待你的判断…」 was");
  const game = read("js/game.js");
  assert.match(game, /import \{ initReturnsLayout \} from '\.\/returns-layout\.js';/);
  assert.match(game, /initActionZoneSync\(\);\s*\n\s*initReturnsLayout\(\);/);
  for (const f of ["index.html", "css/game.css", "js/game.js"]) {
    assert.doesNotMatch(read(f), /data-returns-layout|rl-strip|rlStrip/, `${f} has no B / toggle leftovers`);
  }
});

test("returns layout CSS: phone-only, trade buttons untouched, positive red / negative green", () => {
  const css = read("css/game.css");
  const block = css.slice(css.indexOf("===== Phone: key return figures on the first screen"));
  assert.match(block, /^\.rl-card, \.rl-info \{ display: none; \}$/m, "hidden on desktop");
  assert.match(block, /^\.rl-hint-row \{ display: contents; \}$/m, "hint wrapper inert on desktop");
  const rules = block.slice(block.indexOf("@media (max-width: 900px)"));
  assert.ok(rules.length > 100);
  const outside = block.slice(0, block.indexOf("@media (max-width: 900px)"));
  assert.doesNotMatch(outside, /#progressMood|#fastForwardBtn|\.ff-hint/, "nothing outside the phone query hides desktop parts");
  assert.doesNotMatch(rules, /#(buyBtn|sellBtn|holdBtn)|\.action-btn|\.ctl-(buy|sell|hold)/, "buy/sell/hold sizes are not changed");
  assert.match(rules, /\.rl-v\.positive \{ color: var\(--gain-color\); \}/);
  assert.match(rules, /\.rl-v\.negative \{ color: var\(--loss-color\); \}/);
  assert.match(rules, /\.game-progress-meta\.rl-has-card #progressMood \{ display: none; \}/);
  assert.match(rules, /html:not\(\.rl-hints-open\) #gameScreen \.rl-zone \.ff-hint \{ display: none; \}/);
  assert.match(rules, /\.rl-zone #fastForwardBtn \{\s*height: 36px;\s*min-height: 36px;/);
});
