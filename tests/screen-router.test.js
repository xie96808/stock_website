import test from "node:test";
import assert from "node:assert/strict";
import { resolveHashRoute, Route } from "../js/screen-router.js";

test("resolveHashRoute maps home / sim / aliases / leaderboard", () => {
  assert.equal(resolveHashRoute(""), Route.HOME);
  assert.equal(resolveHashRoute("home"), Route.HOME);
  assert.equal(resolveHashRoute("sim"), Route.SIM);
  assert.equal(resolveHashRoute("academy"), Route.ACADEMY);
  assert.equal(resolveHashRoute("knowledge"), Route.ACADEMY);
  assert.equal(resolveHashRoute("hindsight"), Route.HINDSIGHT);
  assert.equal(resolveHashRoute("harmony"), Route.HINDSIGHT);
  assert.equal(resolveHashRoute("leaderboard"), Route.LEADERBOARD);
});

test("resolveHashRoute ignores unknown and unhashed screens", () => {
  assert.equal(resolveHashRoute("my-games"), null);
  assert.equal(resolveHashRoute("game"), null);
  assert.equal(resolveHashRoute("nope"), null);
});
