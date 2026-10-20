// M-03: cross-device resume must not paint 第 1 天 / 空仓 / +0.00% before the server state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../js/game.js", import.meta.url), "utf8");
const start = src.slice(src.indexOf("export async function startGame"), src.indexOf("export function applyCloudResume"));

test("state is fetched and applied before the first shell paint and before initChart", () => {
  const fetchAt = start.indexOf("await fetchGameState(pre.cloudGameId)");
  const paintAt = start.indexOf("if (serverApplied || !(resumeActions && resumeActions.length))");
  const chartAt = start.indexOf("await initChart()");
  assert.ok(fetchAt > 0 && paintAt > fetchAt && chartAt > paintAt);
});

test("after initChart the prefetched state is reused (no second /state round trip)", () => {
  assert.match(start, /if \(serverApplied\) \{\s*persistCurrentCloudDraft\(\);\s*updateChart\(\);\s*ok = true;/);
});

test("only event-v1 games with server-side decisions take the prefetch path", () => {
  const fn = src.slice(src.indexOf("export function isServerProgressResume"), src.indexOf("export async function startGame"));
  assert.match(fn, /protocolVersion !== 'event-v1'/);
  assert.match(fn, /gameKind === 'puzzle'/);
  assert.match(fn, /Number\(cloud && cloud\.revision\) > 0/);
});

test("HUD and action zone are hidden while syncing", () => {
  const css = readFileSync(new URL("../css/game.css", import.meta.url), "utf8");
  assert.match(css, /#gameScreen\.is-cloud-syncing \.action-zone/);
  assert.match(start, /classList\.add\('is-cloud-syncing'\)/);
  assert.match(start, /classList\.remove\('is-cloud-syncing'\)/);
});
