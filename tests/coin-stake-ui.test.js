import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stakePayoutRows,
  reelDigits,
  stakeHudSubtitle,
  stakeResultView,
  affordablePresets,
  stakeAffordable,
  clampToBalance,
} from "../js/coin-stake-pure.js";
import { meLine, formatBoardValue, boardNote } from "../js/coin-board-pure.js";
import { wrapAvatarHtml, isMedalId } from "../js/avatar-frame-pure.js";
import { formatPlayHudChrome } from "../js/puzzle-goals-copy.js";
import { validatePlayAction } from "../js/game-play-usecase.js";

test("payout rows show what a ±20% game pays in total, fee only on the win", () => {
  assert.deepEqual(stakePayoutRows(100), [
    { label: "股价涨 20%", value: 118, tone: "up" },
    { label: "股价跌 20%", value: 80, tone: "down" },
  ]);
  assert.deepEqual(stakePayoutRows(5), stakePayoutRows(10)); // clamped to the minimum
});

test("reel digits: three reels, leading zeros dimmed", () => {
  assert.deepEqual(reelDigits(50), [{ digit: 0, dim: true }, { digit: 5, dim: false }, { digit: 0, dim: false }]);
  assert.deepEqual(reelDigits(200), [{ digit: 2, dim: false }, { digit: 0, dim: false }, { digit: 0, dim: false }]);
  assert.deepEqual(reelDigits(100).map((r) => r.dim), [false, false, false]);
});

test("HUD: stake amount only, no buy counter", () => {
  assert.equal(stakeHudSubtitle({ amount: 50 }), "投入 50");
  assert.equal(stakeHudSubtitle(null), "");
  const hud = formatPlayHudChrome({ gameKind: "stake", stakeSubtitle: "投入 50" });
  assert.equal(hud.badge, "韭币局");
  assert.equal(hud.isStake, true);
  assert.equal(hud.isOneshot, false);
});

test("validatePlayAction: a stake game has no buy-count limit", () => {
  const base = { gameKind: "stake", currentDay: 9, gameDays: 30, position: "empty", actions: ["buy", "sell", "buy", "sell", "buy", "sell", "hold", "hold"] };
  assert.equal(validatePlayAction(base, "buy").ok, true);
  assert.equal(validatePlayAction({ ...base, gameKind: null }, "buy").ok, true);
});

test("result card rows: settled win, settled loss, forfeited", () => {
  const win = stakeResultView({ amount: 100, status: "settled", profit: 30, fee: 3, payout: 127, net: 27 });
  assert.equal(win.headline, "赚了 27 韭币");
  assert.deepEqual(win.rows.map((r) => r.label), ["投入", "盈亏", "对局费（盈利的 10%）", "到账"]);
  const loss = stakeResultView({ amount: 100, status: "settled", profit: -30, fee: 0, payout: 70, net: -30 });
  assert.equal(loss.headline, "亏了 30 韭币");
  assert.ok(!loss.rows.some((r) => r.label.includes("对局费")));
  const lost = stakeResultView({ amount: 40, status: "forfeited", net: -40 });
  assert.equal(lost.rows.at(-1).value, "0");
  assert.equal(stakeResultView({ amount: 10, status: "settled", returnPpm: 42100, profit: 0, fee: 0, payout: 10, net: 0 }).headline, "涨跌不足 1 韭币，本金原样退回");
  assert.equal(stakeResultView({ amount: 10, status: "settled", returnPpm: 0, profit: 0, fee: 0, payout: 10, net: 0 }).headline, "不赚不亏，本金原样退回");
  assert.equal(stakeResultView({ amount: 40, status: "open" }), null);
  assert.equal(stakeResultView(null), null);
});

test("affordability helpers", () => {
  assert.deepEqual(affordablePresets(60), [50]);
  assert.deepEqual(affordablePresets(150), [50, 100]);
  assert.deepEqual(affordablePresets(1000), [50, 100, 200, 500]);
  assert.deepEqual(affordablePresets(3), [10]);
  assert.equal(stakeAffordable(50, 49), false);
  assert.equal(stakeAffordable(50, null), true); // balance unknown → let the server decide
  assert.equal(clampToBalance(500, 35), 35);
  assert.equal(clampToBalance(900, 800), 500); // never above the stake cap
  assert.equal(clampToBalance(50, 5), 50); // can't afford the minimum: keep the stake, the button will say 韭币不足
});

test("coin board copy", () => {
  assert.equal(formatBoardValue("week", 12), "+12");
  assert.equal(formatBoardValue("balance", 12), "12");
  assert.match(meLine("balance", { rank: 3, value: 900 }), /排第 3 名/);
  assert.match(meLine("week", { rank: null, reason: "no_net_gain" }), /还没有净赚/);
  assert.match(meLine("balance", { rank: null, reason: "not_opted_in" }), /参与排行榜/);
  assert.equal(meLine("balance", null), null);
  assert.match(boardNote("week"), /周一 0 点/);
});

test("medal plaque wraps the avatar (with or without a frame) and ignores unknown ids", () => {
  assert.equal(isMedalId("gold"), true);
  assert.equal(isMedalId("platinum"), false);
  assert.equal(wrapAvatarHtml("<img>", null, null), "<img>");
  assert.equal(wrapAvatarHtml("<img>", null, "nope"), "<img>");
  const m = wrapAvatarHtml("<img>", null, "gold");
  assert.match(m, /^<span class="avm avm--gold" data-avm="1"><img><span class="avm-plaque"[^>]*>冠<\/span><\/span>$/);
  const both = wrapAvatarHtml("<img>", "gold", "silver");
  assert.match(both, /avm--silver/);
  assert.match(both, /avf--gold/);
  assert.ok(both.indexOf("avm--silver") < both.indexOf("avf--gold"), "plaque wrapper is outermost");
});

test("my-games: stake rows show net coins; other rows show nothing", async () => {
  const { stakeNetChip } = await import("../js/my-games.js");
  assert.equal(stakeNetChip(null), "");
  assert.equal(stakeNetChip({ status: "forfeited", amount: 10, net: -10 }), "");
  const win = stakeNetChip({ status: "settled", amount: 100, payout: 127, net: 27 });
  assert.match(win, /投入 100 → 到账 127/);
  assert.match(win, /class="pos">\+27 韭币/);
  assert.match(stakeNetChip({ status: "settled", amount: 100, payout: 70, net: -30 }), /class="neg">-30 韭币/);
});

test("markup wiring: picker, fold toggle and result box exist; classic card stays reachable", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["stakePicker", "stakeInput", "stakeRange", "stakePresets", "stakeSwitchBtn", "stakeModeCard", "classicFoldToggle", "classicModeCard", "stakeResultBox"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /css\/coin-stake\.css/);
});
