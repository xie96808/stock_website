import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repo = process.env.LEADERBOARD_SCROLL_TEST_ROOT || fileURLToPath(new URL("../", import.meta.url));
const home = readFileSync(resolve(repo, "js/home-ia.js"), "utf8");
const leaderboard = readFileSync(resolve(repo, "js/leaderboard.js"), "utf8");

test("closing play-modes for the leaderboard hides both sheet nodes and clears the global scroll lock", () => {
  const start = home.indexOf("function hidePlayModesPanel()");
  const end = home.indexOf("\nfunction hidePuzzleChaptersPanel", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const modes = { hidden: false, style: { transform: "translateY(0)" }, classList: { remove: (...args) => calls.push(["sheet", ...args]) } };
  const backdrop = { hidden: false, attrs: {}, setAttribute: (k, v) => { backdrop.attrs[k] = v; } };
  const root = { classList: { remove: (...args) => calls.push(["root", ...args]) } };
  const context = vm.createContext({
    document: { getElementById: id => id === "playModes" ? modes : id === "playModesBackdrop" ? backdrop : null, documentElement: root },
    playModesEl: () => modes, teardownPlayModesSheetChrome: () => calls.push(["teardown"]),
  });
  const helper = home.slice(start, end);
  vm.runInContext(`${helper}; hidePlayModesPanel();`, context);
  assert.equal(modes.hidden, true);
  assert.equal(modes.style.transform, "");
  assert.deepEqual(backdrop.attrs, { "aria-hidden": "true" });
  assert.equal(backdrop.hidden, true);
  assert.deepEqual(calls, [
    ["sheet", "pm-sheet-open", "is-dragging"], ["root", "pm-sheet-open"], ["teardown"],
  ]);
});

test("leaderboard closes the sheet before prepareScreen hides its parent start screen", () => {
  assert.ok(home.includes("export function hidePlayModesPanel()"));
  assert.ok(/import \{ hidePlayModesPanel \} from \"\.\/home-ia\.js\"/.test(leaderboard));
  const start = leaderboard.indexOf("export async function showLeaderboard");
  const end = leaderboard.indexOf('  let screen = document.getElementById("leaderboardScreen")', start);
  const route = leaderboard.slice(start, end);
  assert.ok(route.indexOf("hidePlayModesPanel();") >= 0);
  assert.ok(route.indexOf("hidePlayModesPanel();") < route.indexOf("prepareScreen(Route.LEADERBOARD)"));
});
