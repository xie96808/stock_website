// A-01: window.__sgBack() — one back step for the Android App back key.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseBackAction, chooseWebBackStep } from "../js/back-handler.js";

test("topmost dialog closes first", () => {
  assert.deepEqual(chooseBackAction({ closers: ["x1", "x2"], backButtons: ["b"], activeScreens: ["gameScreen"] }), { kind: "close", target: "x1" });
});
test("fill-mode sheet cancels before screen back", () => {
  assert.equal(chooseBackAction({ fillModeOpen: true, backButtons: ["b"] }).kind, "cancel-fill-mode");
});
test("screen's own 返回 button next", () => {
  assert.deepEqual(chooseBackAction({ backButtons: ["返回"] }), { kind: "back-button", target: "返回" });
});
test("in a game / PvP room with nothing to close: consume, never exit", () => {
  assert.equal(chooseBackAction({ activeScreens: ["gameScreen"] }).kind, "stay");
  assert.equal(chooseBackAction({ activeScreens: ["pvpRoomScreen"] }).kind, "stay");
});
test("home with nothing open: let the host exit", () => {
  assert.equal(chooseBackAction({}).kind, "exit");
});
test("installed on window from the main module", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /import \{ initBackHandler \} from '\.\/js\/back-handler\.js';/);
  assert.match(html, /initBackHandler\(\);/);
  const src = readFileSync(new URL("../js/back-handler.js", import.meta.url), "utf8");
  assert.match(src, /window\.__sgBack = sgBack/);
});

test("web back: only the base entry triggers a step; guard / pm entries and foreign hrefs are ignored", () => {
  const base = "http://x/";
  assert.equal(chooseWebBackStep({ state: null, href: base, baseHref: base }), "handle");
  assert.equal(chooseWebBackStep({ state: { sgGuard: true }, href: base, baseHref: base }), "ignore");
  assert.equal(chooseWebBackStep({ state: { pmSheet: true }, href: base, baseHref: base }), "ignore");
  assert.equal(chooseWebBackStep({ state: null, href: base + "#/x", baseHref: base }), "ignore");
  assert.equal(chooseWebBackStep({}), "ignore");
});
