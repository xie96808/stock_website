import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const css = readFileSync(new URL("../css/controls-p4.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
test("P4 stylesheet + init wired after controls.css", () => {
  assert.ok(html.indexOf("css/controls-p4.css") > html.indexOf("css/controls.css"));
  assert.match(html, /initP4Controls\(\)/);
});
test("P4 assets referenced exist (1x + 2x webp)", () => {
  const names = [...new Set([...css.matchAll(/controls\/(ctl-[a-z-]+?)(@2x)?\.webp/g)].map((m) => m[1]))];
  assert.ok(names.length >= 20);
  for (const n of names) for (const s of ["", "@2x"]) assert.ok(existsSync(new URL(`../assets/controls/${n}${s}.webp`, import.meta.url)), n + s);
});
test("P4 skins are light-theme only and gain red / loss green", () => {
  assert.ok(!/^\[data-theme="dark"\]/m.test(css));
  assert.match(css, /\.board-chip\.positive[\s\S]*?--p4-tag-red/);
  assert.match(css, /\.board-chip\.negative[\s\S]*?--p4-tag-green/);
  assert.match(css, /--p4-press-ms:\s*70ms/);
});
