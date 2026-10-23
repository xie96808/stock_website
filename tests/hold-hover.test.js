import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");

/** Strip `@media (hover: hover) and (pointer: fine) { … }` blocks (one nesting level). */
function outsideHoverMedia(css) {
  let out = "", i = 0;
  const tag = "@media (hover: hover) and (pointer: fine) {";
  while (i < css.length) {
    const j = css.indexOf(tag, i);
    if (j < 0) { out += css.slice(i); break; }
    out += css.slice(i, j);
    let depth = 0, k = j + tag.length - 1;
    for (; k < css.length; k++) { if (css[k] === "{") depth++; else if (css[k] === "}" && --depth === 0) break; }
    i = k + 1;
  }
  return out;
}

test("观望 keeps its hand-drawn shell on hover: no background shorthand on .action-btn.hold:hover", () => {
  const game = read("css/game.css");
  assert.doesNotMatch(game, /\.action-btn\.hold:hover[^{]*\{[^}]*\bbackground\s*:/, "shorthand would wipe background-image");
  assert.match(game, /\.action-btn\.hold:not\(\.ctl\):hover:not\(:disabled\) \{ background-color: var\(--chip-bg\); \}/);
});

test("trade-button hover effects only apply where a pointer really hovers (no sticky tap state)", () => {
  for (const f of ["css/game.css", "css/controls.css"]) {
    const rest = outsideHoverMedia(read(f));
    assert.doesNotMatch(rest, /\.action-btn(\.(buy|sell|hold))?:hover/, `${f}: .action-btn:hover outside @media (hover: hover)`);
  }
  assert.match(read("css/controls.css"), /@media \(hover: hover\) and \(pointer: fine\) \{\n\.action-btn:hover:not\(:disabled\)/);
  // the shell image itself comes from the non-hover rule, so hover/focus/active keep it
  assert.match(read("css/controls.css"), /\.action-btn\.ctl\.hold \{ background-image: url\("\.\.\/assets\/controls\/ctl-hold-default\.webp/);
});
