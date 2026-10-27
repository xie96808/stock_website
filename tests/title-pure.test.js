import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TITLE_ART, isTitleId, titleName, titleChipHtml, setTitleChip } from "../js/title-pure.js";
import { TITLES } from "../server/src/lib/titleDefs.js";

test("client title art mirrors the server catalogue (ids, names, tiers)", () => {
  assert.deepEqual(Object.keys(TITLE_ART).sort(), TITLES.map((t) => t.id).sort());
  for (const t of TITLES) {
    assert.equal(TITLE_ART[t.id].name, t.name, t.id);
    assert.equal(TITLE_ART[t.id].tier, t.tier, t.id);
  }
});

test("prices climb with the tier", () => {
  const rank = { plain: 0, red: 1, gold: 2, shine: 3, legend: 4 };
  const sorted = [...TITLES].sort((a, b) => a.price - b.price);
  for (let i = 1; i < sorted.length; i++) assert.ok(rank[sorted[i].tier] >= rank[sorted[i - 1].tier], sorted[i].id);
});

test("chip markup: known ids render, unknown render nothing", () => {
  assert.equal(isTitleId("rookie"), true);
  assert.equal(isTitleId("nope"), false);
  assert.equal(isTitleId("__proto__"), false);
  assert.equal(titleName("a_share_legend"), "A股传说");
  assert.equal(titleChipHtml("nope"), "");
  assert.equal(titleChipHtml(null), "");
  assert.match(titleChipHtml("leek_emperor"), /class="ttl ttl--shine" data-ttl="leek_emperor">一代韭皇</);
  assert.match(titleChipHtml("rookie", { size: "lg" }), /ttl--lg/);
});

test("setTitleChip is idempotent and clears on unknown", () => {
  const sibling = { dataset: { ttl: "" }, removed: false, remove() { this.removed = true; } };
  const calls = [];
  const el = { parentElement: {}, nextElementSibling: sibling, insertAdjacentHTML: (pos, html) => calls.push([pos, html]) };
  setTitleChip(el, "rookie");
  assert.equal(sibling.removed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "afterend");
  calls.length = 0;
  setTitleChip(el, null);
  assert.equal(calls.length, 0);
});

test("stylesheet has a look for every tier and respects reduced motion", () => {
  const css = readFileSync(new URL("../css/leek-shop.css", import.meta.url), "utf8");
  for (const tier of ["plain", "red", "gold", "shine", "legend"]) assert.ok(css.includes(`.ttl--${tier}`), tier);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.ttl--shine::after/);
});

test("shop tabs only import modules that exist, and the old frame entry is gone", () => {
  const shop = readFileSync(new URL("../js/leek-shop.js", import.meta.url), "utf8");
  for (const m of ["frame-shop", "cosmetic-shop", "title-shop", "rename-card-shop"]) {
    assert.ok(shop.includes(`./${m}.js`), m);
    readFileSync(new URL(`../js/${m}.js`, import.meta.url), "utf8");
  }
  const auth = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
  assert.ok(!auth.includes("settingsFrameBtn"));
});
