import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chipModels, claimLabel, subText, noteText, pillModel, claimToast, shouldAutoOpen } from "../js/login-streak-pure.js";

const REWARDS = [20, 25, 30, 35, 40, 50, 60].map((coins, i) => ({ day: i + 1, coins, spins: i === 6 ? 1 : 0 }));
const st = (o = {}) => ({ enabled: true, today: "2026-11-02", claimedToday: false, day: 1, runDays: 0, bestRun: 0, broken: false, rewards: REWARDS, next: { coins: 20, spins: 0 }, ...o });

test("chips: first visit highlights day 1, later days are future", () => {
  const c = chipModels(st());
  assert.equal(c.length, 7);
  assert.deepEqual(c.map((x) => x.status), ["today", "future", "future", "future", "future", "future", "future"]);
  assert.equal(c[6].spins, 1);
});

test("chips: mid-cycle shows earlier days done, today highlighted", () => {
  assert.deepEqual(chipModels(st({ day: 4, next: { coins: 35, spins: 0 } })).map((x) => x.status), ["done", "done", "done", "today", "future", "future", "future"]);
});

test("chips: after claiming, today's day turns done and nothing is 'today'", () => {
  const c = chipModels(st({ day: 3, claimedToday: true, next: null, runDays: 3 }));
  assert.deepEqual(c.map((x) => x.status), ["done", "done", "done", "future", "future", "future", "future"]);
});

test("labels reflect claimable vs claimed", () => {
  assert.equal(claimLabel(st({ day: 4, next: { coins: 35, spins: 0 } })), "领取 +35 韭币");
  assert.equal(claimLabel(st({ claimedToday: true, next: null })), "今天已领取");
  assert.equal(claimLabel({ enabled: false }), "");
  assert.match(subText(st({ day: 4 })), /第 4 天/);
  assert.match(subText(st({ claimedToday: true, runDays: 3, bestRun: 9, next: null })), /已连续 3 天（最长 9 天）/);
  assert.doesNotMatch(subText(st({ claimedToday: true, runDays: 3, bestRun: 3, next: null })), /最长/);
});

test("notes: broken-streak reassurance, day-7 spin hint, nothing when wheel is off", () => {
  assert.match(noteText(st({ broken: true, day: 3 })), /只退一档/);
  assert.match(noteText(st()), /第 7 天额外送 1 次转盘/);
  const noWheel = st({ rewards: REWARDS.map((r) => ({ ...r, spins: 0 })) });
  assert.equal(noteText(noWheel), "");
});

test("pill: hidden when off, shows reward when claimable, run when claimed", () => {
  assert.equal(pillModel({ enabled: false }), null);
  assert.deepEqual(pillModel(st({ day: 2, next: { coins: 25, spins: 0 } })), { text: "连续登录奖励", button: "领 +25", claimable: true });
  assert.deepEqual(pillModel(st({ claimedToday: true, runDays: 5, next: null })), { text: "连续登录 5 天", button: "查看", claimable: false });
});

test("claim toast mentions the bonus spin only when granted", () => {
  assert.equal(claimToast({ day: 3, coins: 30, spins: 0 }), "连续登录第 3 天 +30 韭币");
  assert.equal(claimToast({ day: 7, coins: 60, spins: 1 }), "连续登录第 7 天 +60 韭币，转盘 +1 次");
});

test("auto-open: once per Shanghai day, only when claimable", () => {
  assert.equal(shouldAutoOpen(st(), ""), true);
  assert.equal(shouldAutoOpen(st(), "2026-11-02"), false);
  assert.equal(shouldAutoOpen(st({ claimedToday: true }), ""), false);
  assert.equal(shouldAutoOpen({ enabled: false }, ""), false);
});

test("wiring: home pill, stylesheet and init are in index.html", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="homeStreak"/);
  assert.match(html, /css\/login-streak\.css/);
  assert.match(html, /initLoginStreak\(\)/);
});
