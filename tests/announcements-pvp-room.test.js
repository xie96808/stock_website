// M-09: 系统公告 must not auto-open over a PvP room / invite join.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldAutoOpenAnnouncements } from "../js/announcements.js";

test("auto-open is skipped only for PvP room / join routes", () => {
  for (const h of ["", "#/", "#/pvp", "#/game", "#/result", "#/leaderboard"]) assert.equal(shouldAutoOpenAnnouncements(h), true, h);
  for (const h of ["#/pvp/join/ww3tnb3n", "#/pvp/94bdbd22-4d42-465f-90f8-71e7d352230d"]) assert.equal(shouldAutoOpenAnnouncements(h), false, h);
});

test("initAnnouncements checks the route before auto-opening", () => {
  const src = readFileSync(new URL("../js/announcements.js", import.meta.url), "utf8");
  const init = src.slice(src.indexOf("export async function initAnnouncements"));
  assert.match(init, /shouldAutoOpenAnnouncements\(location\.hash\)/);
});
