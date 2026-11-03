// 开一局进场界面 / 结算页的老虎机点缀：只能作用在 stake 的页面上，经典局等不受影响。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/stake-play.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const game = readFileSync(new URL("../js/game.js", import.meta.url), "utf8");
const result = readFileSync(new URL("../js/result.js", import.meta.url), "utf8");

/** Split a selector list on top-level commas only (not the ones inside :is(...)). */
function splitList(group) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of group) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

/** Top-level selectors of every style rule (skips @keyframes bodies and comments). */
function selectors(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let depth = 0;
  let buf = "";
  let inKeyframes = false;
  const stack = [];
  for (const ch of noComments) {
    if (ch === "{") {
      const head = buf.trim();
      if (head.startsWith("@keyframes")) inKeyframes = true;
      else if (!inKeyframes && !head.startsWith("@")) out.push(head);
      stack.push(head);
      depth++;
      buf = "";
    } else if (ch === "}") {
      depth--;
      const head = stack.pop();
      if (head && head.startsWith("@keyframes")) inKeyframes = false;
      buf = "";
    } else if (ch === ";" && depth === 0) {
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

test("every rule in stake-play.css is scoped to a stake-only screen", () => {
  const sel = selectors(css);
  assert.ok(sel.length > 10);
  for (const group of sel) {
    for (const one of splitList(group)) {
      assert.match(
        one,
        /^(\[data-theme="dark"\] )?(#gameScreen\.game-screen--stake|#resultScreen\.result-screen--stake)\b/,
        `unscoped selector: ${one}`
      );
    }
  }
});

test("stake-play.css is linked after the control skins so it can override them", () => {
  const i = html.indexOf('href="css/stake-play.css"');
  assert.ok(i > 0, "index.html links css/stake-play.css");
  assert.ok(i > html.indexOf('href="css/controls-p5.css"'));
  assert.ok(i > html.indexOf('href="css/game.css"') || !html.includes('href="css/game.css"'));
});

test("the game and result screens toggle the stake class from the game kind", () => {
  assert.match(game, /classList\.toggle\('game-screen--stake', !!hud\.isStake\)/);
  assert.match(result, /classList\.toggle\('result-screen--stake', view\.gameKind === 'stake'\)/);
});

test("trade buttons override the hand-drawn sprites with !important, and the pressed / disabled states exist", () => {
  assert.match(css, /background-image: none !important/);
  assert.match(css, /border: 2\.5px solid var\(--line\) !important/);
  assert.match(css, /:active:not\(:disabled\)/);
  assert.match(css, /\[data-state="locked"\]/);
});

test("motion respects prefers-reduced-motion", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /game-progress-shell::before \{ animation: none; \}/);
});
