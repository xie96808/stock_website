import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { EMOJI_ART, COMMODITY_ART_KEY, emojiArtHtml, commodityArtHtml, EMOJI_ART_V } from "../js/emoji-art.js";
import { GIFT_ART } from "../js/pvp/gift-art.js";
import { DEFAULT_COMMODITIES } from "../js/hindsight-pure.js";

test("slot keeps the emoji as an invisible spacer and overlays day (+night) PNG art", () => {
  const html = emojiArtHtml("cm-coffee");
  assert.match(html, /^<span class="ea-slot ea-slot--themed ea-cm-coffee" data-ea="cm-coffee">/);
  assert.match(html, /<span class="ea-spacer">☕<\/span>/);
  assert.match(html, new RegExp(`cm-coffee\\.png\\?v=${EMOJI_ART_V} 1x, assets/icon-unify/cm-coffee@2x\\.png`));
  assert.match(html, /ea-img--night[^>]*cm-coffee-dark\.png[^>]*loading="lazy"/);
  assert.doesNotMatch(html, /<picture|\.webp/, "html2canvas needs a plain <img> PNG");
  const cam = emojiArtHtml("camera");
  assert.doesNotMatch(cam, /ea-slot--themed|ea-img--night/, "camera sits on kraft in both themes");
  assert.match(emojiArtHtml("cm-sprout", { size: 14 }), /style="--ea-px:14px"[^]*width="14" height="14"/);
});

test("unknown keys / unmapped emoji degrade to the plain (escaped) text", () => {
  assert.equal(emojiArtHtml("nope", { emoji: "<b>" }), "&lt;b&gt;");
  assert.equal(commodityArtHtml("🍔"), "🍔");
});

test("every hindsight commodity + the empty-state sprout has art", () => {
  for (const c of DEFAULT_COMMODITIES) assert.ok(COMMODITY_ART_KEY[c.icon], `no art for ${c.icon}`);
  assert.equal(COMMODITY_ART_KEY["🌱"], "cm-sprout");
  assert.equal(Object.keys(COMMODITY_ART_KEY).length, 8);
});

test("all referenced art files exist (1x/2x, day and dark where themed)", () => {
  for (const [key, a] of Object.entries(EMOJI_ART)) {
    for (const f of [a.file, ...(a.dark ? [`${a.file}-dark`] : [])]) {
      for (const sfx of [".png", "@2x.png"]) assert.ok(existsSync(`assets/icon-unify/${f}${sfx}`), `${key}: ${f}${sfx}`);
    }
  }
  for (const [kind, g] of Object.entries(GIFT_ART)) {
    const stem = g.file || kind;
    for (const f of [stem, ...(g.dark ? [`${stem}-dark`] : [])]) {
      for (const sfx of [".png", "@2x.png", ".webp", "@2x.webp"]) assert.ok(existsSync(`assets/pvp/gift-${f}${sfx}`), `gift ${f}${sfx}`);
    }
  }
});

test("all six gifts have day+dark art; the four P3 ones keep the emoji glyph box; fish/leaf keep their layout", () => {
  assert.deepEqual(Object.keys(GIFT_ART).sort(), ["coffee", "fish", "flower", "leaf", "pipe", "tomato"]);
  for (const k of ["flower", "tomato", "pipe", "coffee"]) assert.equal(GIFT_ART[k].keepGlyphBox, true);
  // fish/leaf: redrawn art with -dark variants, but no keepGlyphBox (their shipped picker layout is unchanged).
  assert.deepEqual(GIFT_ART.fish, { name: "臭鱼", emoji: "🐟", dark: true });
  assert.deepEqual(GIFT_ART.leaf, { name: "菜叶", emoji: "🥬", dark: true });
});

test("static markup uses the slots; fallback CSS restores the emoji in the same box", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /<span class="apk-download-icon" aria-hidden="true"><span class="ea-slot[^"]*ea-apk-phone"/);
  assert.match(html, /<span class="ctl-label"><span class="ea-slot ea-camera"[^]*?<\/span> 生成分享图<\/span>/);
  assert.match(html, /<span class="ctl-label"><span class="ea-slot ea-clipboard"[^]*?<\/span> 复制文案<\/span>/);
  assert.match(html, /href="css\/emoji-art\.css"/);
  const auth = readFileSync("js/auth.js", "utf8");
  assert.equal((auth.match(/\$\{emojiArtHtml\("dice"\)\}<\/button>/g) || []).length, 4);
  const css = readFileSync("css/emoji-art.css", "utf8");
  assert.match(css, /\.ea-spacer\s*\{\s*visibility:\s*hidden;/);
  assert.match(css, /\.ea-slot\.ea-fallback > \.ea-img \{ display: none !important; \}/);
  assert.match(css, /\.ea-slot\.ea-fallback > \.ea-spacer \{ visibility: visible; \}/);
});
