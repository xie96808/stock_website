import test from "node:test";
import assert from "node:assert/strict";
import { stakeSettlement, isValidStake, clampStake, countBuys, checkStakeNextAction, checkStakeActionList, STAKE_MIN, STAKE_MAX } from "../shared/stake.js";

test("stake range", () => {
  assert.ok(isValidStake(STAKE_MIN) && isValidStake(STAKE_MAX));
  for (const bad of [9, 201, 10.5, "50", NaN, null, undefined]) assert.equal(isValidStake(bad), false);
  assert.equal(clampStake(5), 10);
  assert.equal(clampStake(999), 200);
  assert.equal(clampStake("abc"), 10);
});

test("settlement: fee only on positive profit, payout never negative", () => {
  assert.deepEqual(stakeSettlement(100, 200000), { stake: 100, profit: 20, fee: 2, payout: 118, net: 18 });
  assert.deepEqual(stakeSettlement(100, -300000), { stake: 100, profit: -30, fee: 0, payout: 70, net: -30 });
  assert.deepEqual(stakeSettlement(100, 0), { stake: 100, profit: 0, fee: 0, payout: 100, net: 0 });
  assert.deepEqual(stakeSettlement(200, -1_000_000), { stake: 200, profit: -200, fee: 0, payout: 0, net: -200 });
  // beyond −100% cannot go below zero (return is capped by the engine, but the maths must hold anyway)
  assert.equal(stakeSettlement(50, -2_000_000).payout, 0);
  // no cap on the upside: +300% on 200 coins
  assert.deepEqual(stakeSettlement(200, 3_000_000), { stake: 200, profit: 600, fee: 60, payout: 740, net: 540 });
  // fee floors, symmetric rounding of profit
  assert.equal(stakeSettlement(10, 150000).profit, 2); // 1.5 → 2
  assert.equal(stakeSettlement(10, -150000).profit, -2);
  assert.equal(stakeSettlement(10, 150000).fee, 0); // floor(0.2)
});

test("buy limit: two buys, the third is refused", () => {
  assert.equal(countBuys(["buy", "hold", { action: "buy" }, "sell"]), 2);
  assert.equal(checkStakeNextAction(["buy", "sell"], "buy").ok, true);
  const r = checkStakeNextAction(["buy", "sell", "buy", "sell"], "buy");
  assert.equal(r.ok, false);
  assert.equal(r.code, "STAKE_BUY_LIMIT");
  assert.equal(checkStakeNextAction(["buy", "sell", "buy", "sell"], "hold").ok, true);
  assert.equal(checkStakeActionList(["buy", "sell", "buy"]).ok, true);
  assert.equal(checkStakeActionList(["buy", "sell", "buy", "sell", "buy"]).ok, false);
});
