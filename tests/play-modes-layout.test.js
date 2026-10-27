import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("play-modes sheet groups rarely-used modes into a tile row and the links into a button row", () => {
  const html = read("../index.html");
  const css = read("../css/play-modes-sheet.css");
  const list = html.slice(html.indexOf('id="playModesList"'), html.indexOf('id="playModesFoot"'));
  const tiles = list.slice(list.indexOf('id="playModesTiles"'), list.indexOf('id="playModesLinks"'));
  const links = list.slice(list.indexOf('id="playModesLinks"'));
  for (const id of ["oneshotModeCard", "survivalModeCard", "puzzleChapterCard"]) {
    assert.ok(tiles.includes(`id="${id}"`), `${id} sits in the tile row`);
  }
  for (const id of ["myGamesModeCard", "leaderboardModeCard"]) {
    assert.ok(links.includes(`id="${id}"`), `${id} sits in the link row`);
  }
  // the two everyday modes stay full-width cards, ahead of the groups
  assert.ok(list.indexOf('id="dailyChallengeCard"') < list.indexOf('id="playModesTiles"'));
  assert.ok(list.indexOf('id="classicModeCard"') < list.indexOf('id="playModesTiles"'));
  // a row whose cards are all feature-flagged off takes no space
  assert.match(css, /\.pm-tiles:not\(:has\(> :not\(\[hidden\]\)\)\)/);
});

test("card markers other modules and tests rely on are untouched", () => {
  const html = read("../index.html");
  assert.match(html, /survival-mode-cta">开始</);
  assert.match(html, /oneshot-mode-cta">开始</);
  assert.match(html, /id="oneshotModeCard"[\s\S]*?lane-cost-n">30</);
});

test("tiles show only the mode name: the subtitle is hidden in the tile row", () => {
  assert.match(read("../css/play-modes-sheet.css"), /\.pm-tiles \.lane\.lane--compact \.copy \.lane-note \{ display: none; \}/);
});
