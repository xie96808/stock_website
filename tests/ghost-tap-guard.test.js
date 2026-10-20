// M-12: a quick double tap on a mode card must not close the overlay it just opened.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGhostTap, GHOST_TAP_GUARD_MS } from "../js/controls.js";

test("backdrop taps right after opening are swallowed, later ones close", () => {
  assert.equal(GHOST_TAP_GUARD_MS, 350);
  assert.equal(isGhostTap(1000, 1000, false), true);
  assert.equal(isGhostTap(1000, 1080, false), true);
  assert.equal(isGhostTap(1000, 1349, false), true);
  assert.equal(isGhostTap(1000, 1350, false), false);
  assert.equal(isGhostTap(1000, 2000, false), false);
});

test("taps inside the dialog panel are never swallowed", () => {
  assert.equal(isGhostTap(1000, 1010, true), false);
});

test("never-opened overlay is not guarded", () => {
  assert.equal(isGhostTap(undefined, 10, false), false);
});

test("openCtlOverlay arms the guard (shared by fill-mode sheet and daily confirm)", () => {
  const src = readFileSync(new URL("../js/controls.js", import.meta.url), "utf8");
  const open = src.slice(src.indexOf("export function openCtlOverlay"));
  assert.match(open.slice(0, 600), /armGhostTapGuard\(overlay\)/);
});
