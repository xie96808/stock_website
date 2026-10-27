import test from "node:test";
import assert from "node:assert/strict";
import {
  sections, progressPct, progressLabel, rewardLabel, pillModel, claimAllLabel, subText, claimToast, unlockName,
} from "../js/achievements-pure.js";

const groups = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "empty", name: "空" }];
const items = [
  { key: "a1", group: "a", progress: 10, target: 10, coins: 20, claimed: true, claimable: false },
  { key: "a2", group: "a", progress: 3, target: 10, coins: 40, claimed: false, claimable: false },
  { key: "a3", group: "a", progress: 10, target: 10, coins: 60, claimed: false, claimable: true },
  { key: "b1", group: "b", progress: 0, target: 1, coins: 30, unlock: "frame:laurel", claimed: false, claimable: false },
];
const state = {
  enabled: true, groups, items,
  summary: { total: 4, claimed: 1, claimable: 1, claimableCoins: 60, earnedCoins: 20 },
};

test("sections: group order kept, empty groups dropped, claimable first, claimed last", () => {
  const s = sections(state);
  assert.deepEqual(s.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(s[0].items.map((i) => i.key), ["a3", "a2", "a1"]);
  assert.equal(s[0].claimed, 1);
  assert.equal(s[0].total, 3);
  assert.equal(s[0].claimable, 1);
  assert.equal(s[1].claimable, 0);
  assert.deepEqual(sections(null), []);
  assert.deepEqual(sections({ items, groups: [] }), []);
});

test("progress helpers", () => {
  assert.equal(progressPct({ progress: 3, target: 10 }), 30);
  assert.equal(progressPct({ progress: 99, target: 10 }), 100);
  assert.equal(progressPct({ progress: 1, target: 0 }), 0);
  assert.equal(progressPct(null), 0);
  assert.equal(progressLabel({ progress: 3, target: 10 }), "3 / 10");
  assert.equal(progressLabel({ progress: 20, target: 50, unit: "%" }), "20% / 50%");
});

test("reward label mentions the unlock", () => {
  assert.equal(rewardLabel({ coins: 40 }), "+40 韭币");
  assert.equal(rewardLabel({ coins: 200, unlock: "frame:laurel" }), "+200 韭币 · 月桂头像框");
  assert.equal(unlockName("frame:unknown"), "限定奖励");
});

test("pill: hidden when disabled, call to action when claimable", () => {
  assert.equal(pillModel(null), null);
  assert.equal(pillModel({ enabled: false }), null);
  assert.deepEqual(pillModel(state), { text: "成就 · 1 个可领取", claimable: true, count: 1 });
  const none = pillModel({ enabled: true, summary: { total: 22, claimed: 3, claimable: 0 } });
  assert.deepEqual(none, { text: "成就 3/22", claimable: false, count: 0 });
});

test("claim-all label and sub text", () => {
  assert.equal(claimAllLabel(state), "全部领取 +60 韭币");
  assert.equal(claimAllLabel({ summary: { claimable: 0 } }), "暂无可领取");
  assert.equal(claimAllLabel(null), "暂无可领取");
  assert.equal(subText(state), "已达成 1/4 · 累计领取 20 韭币");
  assert.equal(subText(null), "");
});

test("claim toast: single, multiple, unlock, empty", () => {
  assert.equal(claimToast({ claimed: [] }), "");
  assert.equal(claimToast(null), "");
  assert.equal(claimToast({ claimed: [{ name: "初出茅庐", coins: 20 }], coins: 20 }), "「初出茅庐」+20 韭币");
  assert.equal(
    claimToast({ claimed: [{ name: "股神附体", coins: 200, unlock: "frame:laurel" }], coins: 200 }),
    "「股神附体」+200 韭币，解锁月桂头像框"
  );
  assert.equal(
    claimToast({ claimed: [{ name: "a", coins: 20 }, { name: "b", coins: 30, unlock: "frame:crown" }], coins: 50 }),
    "领取 2 个成就 +50 韭币，解锁韭王冠头像框"
  );
});
