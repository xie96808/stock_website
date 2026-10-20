import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("pvp result repaints the header coin chip as soon as settlement arrives", () => {
  const result = read("js/pvp/result.js");
  assert.match(result, /import \{[^}]*refreshJiuCoinStatus[^}]*\} from "\.\.\/jiu-coin\.js"/);
  assert.match(result, /function syncHeaderBalance\(view\)/);
  assert.match(result, /status !== "settled" && view\.status !== "aborted"/);
  const show = result.slice(result.indexOf("export function showPvpResult"));
  assert.ok(show.indexOf("syncHeaderBalance(view)") > -1 && show.indexOf("syncHeaderBalance(view)") < show.indexOf("paintResultBody"));
});

test("pvp room refreshes the header coin chip once when play starts (entry fee)", () => {
  const room = read("js/pvp/room.js");
  assert.match(room, /import \{[^}]*refreshJiuCoinStatus[^}]*\} from "\.\.\/jiu-coin\.js"/);
  assert.match(room, /entrySyncedFor !== matchId/);
});
