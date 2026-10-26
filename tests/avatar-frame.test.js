import test from "node:test";
import assert from "node:assert/strict";
import { FRAME_IDS, FRAME_NAMES, isFrameId, frameSvg, wrapAvatarHtml } from "../js/avatar-frame-pure.js";
import { readFileSync } from "node:fs";

test("every frame id has a name and non-empty art", () => {
  assert.equal(FRAME_IDS.length, 6);
  for (const id of FRAME_IDS) {
    assert.ok(FRAME_NAMES[id], `name of ${id}`);
    const svg = frameSvg(id);
    assert.match(svg, /^<svg class="avf-art" viewBox="-10 -10 120 120"/);
    assert.ok(svg.length > 200, `${id} art has substance`);
    assert.ok(!/NaN|undefined/.test(svg), `${id} has no broken numbers`);
    assert.ok(svg.endsWith("</svg>"));
  }
});

test("art differs per frame and is deterministic", () => {
  const all = FRAME_IDS.map(frameSvg);
  assert.equal(new Set(all).size, FRAME_IDS.length);
  assert.equal(frameSvg("gold"), frameSvg("gold"));
});

test("unknown ids draw nothing and leave the avatar markup alone", () => {
  for (const bad of [undefined, null, "", "nope", "__proto__", 3]) {
    assert.equal(isFrameId(bad), false);
    assert.equal(frameSvg(bad), "");
    assert.equal(wrapAvatarHtml("<img>", bad), "<img>");
  }
});

test("wrapAvatarHtml wraps the img and keeps it first", () => {
  const html = wrapAvatarHtml('<img class="lb-avatar" src="a.png">', "bamboo");
  assert.match(html, /^<span class="avf avf--bamboo"><img class="lb-avatar" src="a.png"><svg class="avf-art"/);
  assert.ok(html.endsWith("</svg></span>"));
});

test("client ids match the server catalogue", () => {
  const src = readFileSync(new URL("../server/src/lib/frameDefs.js", import.meta.url), "utf8");
  const serverIds = [...src.matchAll(/\{ id: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...serverIds].sort(), [...FRAME_IDS].sort());
  for (const m of src.matchAll(/\{ id: "([a-z_]+)", name: "([^"]+)"/g)) {
    assert.equal(FRAME_NAMES[m[1]], m[2], `name of ${m[1]}`);
  }
});
