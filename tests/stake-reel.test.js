import test from "node:test";
import assert from "node:assert/strict";
import { reelPlan, reelTotalMs, REEL_BASE_MS, REEL_STEP_MS } from "../js/stake-reel-pure.js";

test("unchanged digits stay still; changed digits roll upward to the new digit", () => {
  const plan = reelPlan("+1.79%", "+1.85%");
  assert.deepEqual(plan.map((c) => c.ch), ["+", "1", ".", "8", "5", "%"]);
  assert.equal(plan[0].strip, null);
  assert.equal(plan[1].strip, null);
  assert.equal(plan[2].strip, null);
  assert.equal(plan[5].strip, null);
  // 7 -> 8 would be a single step: padded to a visible spin of >= 4 lines that ends right before 8
  const eight = plan[3];
  assert.ok(eight.strip.length >= 4);
  assert.equal(eight.strip[0], "7");
  assert.equal(eight.strip.at(-1), "7");
  // 9 -> 5: (5-9+10)%10 = 6 steps: 9,0,1,2,3,4 then the final 5
  assert.deepEqual(plan[4].strip, ["9", "0", "1", "2", "3", "4"]);
});

test("every roll ends on the final character (strip + final is a run of consecutive digits)", () => {
  for (const [a, b] of [["0.00%", "+3.21%"], ["-12.50%", "+0.07%"], ["+9.99%", "+10.00%"]]) {
    for (const c of reelPlan(a, b)) {
      if (!c.strip || !/\d/.test(c.ch)) continue;
      const seq = [...c.strip, c.ch].map(Number);
      for (let i = 1; i < seq.length; i++) assert.equal(seq[i], (seq[i - 1] + 1) % 10);
    }
  }
});

test("a sign flip is a single flip, a brand-new leading digit rolls up from 0", () => {
  const plan = reelPlan("-1.20%", "+1.20%");
  assert.deepEqual(plan[0].strip, ["-"]);
  const grown = reelPlan("+9.99%", "+10.00%");
  assert.equal(grown[1].ch, "1");
  assert.equal(grown[1].strip[0], "0"); // no digit before it: starts at 0
});

test("left cells settle first, right cells last", () => {
  const plan = reelPlan("+0.00%", "+8.88%");
  const durs = plan.map((c) => c.durMs);
  assert.equal(durs[0], REEL_BASE_MS);
  assert.equal(durs[1], REEL_BASE_MS + REEL_STEP_MS);
  for (let i = 1; i < durs.length; i++) assert.ok(durs[i] > durs[i - 1]);
  assert.equal(reelTotalMs(plan), plan.filter((c) => c.strip).at(-1).durMs);
});

test("identical text, or empty -> empty, has nothing to roll", () => {
  assert.equal(reelTotalMs(reelPlan("+1.00%", "+1.00%")), 0);
  assert.deepEqual(reelPlan("", ""), []);
});

// 回归：用户反馈收益率数字卡在半截（动画被浏览器冻住 / 取消后没有落定）。
test("the resting style of a rolling cell is the final character, so a frozen / cancelled animation cannot leave it mid-roll", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../css/stake-play.css", import.meta.url), "utf8");
  const rule = css.match(/\.sp-cell\[data-strip\]::before[^{]*\{([^}]*)\}/);
  assert.ok(rule, "rolling ::before rule exists");
  assert.match(rule[1], /margin-top:\s*calc\(var\(--k, 1\) \* -1\.2em\)/, "base style already sits on the final character");
  assert.match(rule[1], /animation:[^;]*\bbackwards\b/, "animation only back-fills; it never decides the end state");
  assert.doesNotMatch(rule[1], /\bboth\b|\bforwards\b/);
  const kf = css.match(/@keyframes spRoll\s*\{([^}]*\{[^}]*\}[^}]*)\}/);
  assert.ok(kf && !/\bto\s*\{/.test(kf[1]), "keyframes only define the start");
});

test("stake-reel.js settles by timer (not animationend) and when the page comes back", async () => {
  const { readFileSync } = await import("node:fs");
  const js = readFileSync(new URL("../js/stake-reel.js", import.meta.url), "utf8");
  assert.match(js, /setTimeout\(\(\) => settle\(el\)/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /pageshow/);
});
