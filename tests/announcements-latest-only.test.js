import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sortAnnouncements, splitAnnouncements } from "../js/announcements.js";

const js = readFileSync(new URL("../js/announcements.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/announcements.css", import.meta.url), "utf8");

const A = { id: 4, title: "旧", publishedAt: "2026-10-11 17:31:25" };
const B = { id: 6, title: "中", publishedAt: "2026-10-20 01:05:37" };
const C = { id: 7, title: "新", publishedAt: "2026-10-26 15:45:00" };

test("popup shows only the newest notice; the rest is 往期", () => {
  const { latest, earlier } = splitAnnouncements([A, C, B]);
  assert.equal(latest.id, 7);
  assert.deepEqual(earlier.map((n) => n.id), [6, 4]);
});

test("order does not depend on API order; same time falls back to id", () => {
  assert.deepEqual(sortAnnouncements([A, B, C]).map((n) => n.id), [7, 6, 4]);
  const t = "2026-10-26 10:00:00";
  assert.deepEqual(sortAnnouncements([{ id: 1, publishedAt: t }, { id: 2, publishedAt: t }]).map((n) => n.id), [2, 1]);
});

test("empty / single list has no earlier notices (ⓘ stays hidden)", () => {
  assert.deepEqual(splitAnnouncements([]), { latest: null, earlier: [] });
  assert.deepEqual(splitAnnouncements(null), { latest: null, earlier: [] });
  const one = splitAnnouncements([C]);
  assert.equal(one.latest.id, 7);
  assert.equal(one.earlier.length, 0);
});

test("dialog has ⓘ next to the title and a back button for the history view", () => {
  assert.match(js, /id="announcementsInfo"[^>]*aria-label="查看往期公告"/);
  assert.match(js, /id="announcementsBack"[^>]*aria-label="返回最新公告"/);
  assert.match(js, /history: "往期公告"/);
  // opening (button or auto) always starts on the newest notice
  assert.match(js, /showView\("latest", items\)/);
  // ⓘ hidden when there is nothing earlier
  assert.match(js, /info\.hidden = currentView === "history" \|\| !earlier\.length/);
  // the press-then-slip handling covers the new buttons too
  assert.match(js, /#announcementsInfo, #announcementsBack/);
});

test("ⓘ has a ≥40px hit area and history view hides 今日关闭", () => {
  const info = css.slice(css.indexOf(".announcements-info {"));
  assert.match(info, /width: 40px;\s*height: 40px;/);
  assert.match(css, /\[data-view="history"\] #announcementsDismissToday\s*\{\s*display: none;/);
});
