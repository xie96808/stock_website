// M-06: 残局结算「持仓天数」was always 0 (puzzle engine has no holdingDays).
import test from "node:test";
import assert from "node:assert/strict";
import { puzzleHoldingDays } from "../js/game-play-usecase.js";

test("starts holding, never trades → whole window (第一天站岗, 6 日)", () => {
  assert.equal(puzzleHoldingDays({ initialQty: 1000, trades: [], gameDays: 6 }), 6);
});

test("starts holding, sell fills day 3 → days 1–2 held", () => {
  assert.equal(puzzleHoldingDays({ initialQty: 1000, trades: [{ type: "sell", day: 3 }], gameDays: 6 }), 2);
});

test("flat start, buy fills day 2, sell fills day 5 → days 2–4 held", () => {
  assert.equal(
    puzzleHoldingDays({ initialQty: 0, trades: [{ type: "buy", day: 2 }, { type: "sell", day: 5 }], gameDays: 8 }),
    3,
  );
});

test("flat, no trades → 0; mid-game counts only closed days", () => {
  assert.equal(puzzleHoldingDays({ initialQty: 0, trades: [], gameDays: 6 }), 0);
  assert.equal(puzzleHoldingDays({ initialQty: 5, trades: [], gameDays: 2 }), 2);
  assert.equal(puzzleHoldingDays({}), 0);
});
