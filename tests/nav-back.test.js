// Unified back bar: 返回上一级 + 返回主页.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backSpecFor, detectOrigin, exitSheetCopy, HOME, SHEET } from "../js/nav-back.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../js/nav-back.js", import.meta.url), "utf8");

test("top-level sub pages go straight home and offer a single exit", () => {
  for (const k of ["academy", "hindsight", "pvp-lobby"]) {
    const s = backSpecFor(k);
    assert.equal(s.parent, HOME, k);
    assert.equal(s.home, false, k);
  }
});

test("deeper pages offer parent + 返回主页, the label names the parent", () => {
  assert.deepEqual(backSpecFor("academy-zone"), { parent: { id: "academy", label: "修炼基地" }, home: true });
  assert.equal(backSpecFor("puzzle-levels").parent.label, "章节");
  assert.equal(backSpecFor("puzzle-chapters").parent, SHEET);
  assert.equal(backSpecFor("pvp-history").parent.id, "pvp-lobby");
  assert.equal(backSpecFor("pvp-result").home, true);
});

test("排行榜 / 我的战绩 return to where they were opened from", () => {
  for (const k of ["leaderboard", "my-games"]) {
    assert.deepEqual(backSpecFor(k, { origin: "home" }), { parent: HOME, home: false });
    assert.deepEqual(backSpecFor(k, { origin: "sheet" }), { parent: SHEET, home: true });
    assert.deepEqual(backSpecFor(k, { origin: "result" }), { parent: { id: "result", label: "结算页" }, home: true });
    assert.equal(backSpecFor(k).parent, HOME, "unknown origin falls back to home");
  }
});

test("结算 / 对局: parent is 残局列表 for puzzles, 玩法选择 otherwise; always + 返回主页", () => {
  assert.equal(backSpecFor("result", { gameKind: "puzzle" }).parent.id, "puzzle-levels");
  assert.equal(backSpecFor("game", { gameKind: "oneshot" }).parent, SHEET);
  assert.equal(backSpecFor("result").home, true);
  assert.equal(backSpecFor("game").home, true);
});

test("detectOrigin: result screen > open sheet > home", () => {
  const doc = (resultActive, sheetOpen) => ({
    getElementById: (id) => (id === "resultScreen" ? { classList: { contains: (c) => c === "active" && resultActive } } : null),
    documentElement: { classList: { contains: (c) => c === "pm-sheet-open" && sheetOpen } },
  });
  assert.equal(detectOrigin(doc(true, true)), "result");
  assert.equal(detectOrigin(doc(false, true)), "sheet");
  assert.equal(detectOrigin(doc(false, false)), "home");
});

test("exit sheet copy is honest about whether progress is kept", () => {
  assert.match(exitSheetCopy({ cloudMode: true }), /继续对局/);
  assert.match(exitSheetCopy({ cloudMode: false }), /不会保留/);
});

test("every sub page mounts the shared bar; legacy back buttons are gone", () => {
  for (const k of ["academy", "academy-zone", "hindsight", "puzzle-chapters", "puzzle-levels", "pvp-lobby", "pvp-result", "pvp-history", "result", "game"]) {
    assert.match(html, new RegExp(`data-sg-back="${k}"`), k);
  }
  assert.match(html, /id="pvpRoomLeave"/);
  assert.equal((html.match(/data-sg-back="academy-zone"/g) || []).length, 4, "all four zone views");
  // (the PvP room keeps its own 「离开」 button + confirm dialog on purpose)
  for (const legacy of ["academy-back", "zone-back-btn", "hindsight-back", "puzzle-screen-back", 'id="pvpLobbyBack"', 'id="pvpResultBack"', 'id="pvpHistoryBack"']) {
    assert.ok(!html.includes(legacy), `${legacy} should be replaced`);
  }
  for (const f of ["leaderboard", "my-games"]) {
    const js = readFileSync(new URL(`../js/${f}.js`, import.meta.url), "utf8");
    assert.match(js, new RegExp(`data-sg-back="${f}"`));
    assert.match(js, /captureOrigin\(/);
  }
  assert.match(html, /import \{ initNavBack \} from '\.\/js\/nav-back\.js';/);
  assert.match(html, /initNavBack\(\);/);
});

test("parent button keeps legacy ids and starts with 返回 so the system back key presses it", () => {
  assert.match(src, /leaderboardBackBtn/);
  assert.match(src, /`← 返回\$\{spec\.parent\.label\}`/);
  const bh = readFileSync(new URL("../js/back-handler.js", import.meta.url), "utf8");
  assert.match(bh, /退出对局/);
  assert.match(bh, /sg-exit-continue/);
});
