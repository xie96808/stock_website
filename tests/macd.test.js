import test from "node:test";
import assert from "node:assert/strict";
import { calculateEMA, calculateMACD } from "../js/utils.js";

test("MACD produces DIF/DEA/histogram after enough bars", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ close: 100 + Math.sin(i / 5) * 5 + i * 0.2 }));
  const ema = calculateEMA(bars, 12);
  assert.equal(ema[10], null);
  assert.ok(Number.isFinite(ema[11]));
  const macd = calculateMACD(bars);
  const last = bars.length - 1;
  assert.ok(Number.isFinite(macd.dif[last]));
  assert.ok(Number.isFinite(macd.dea[last]));
  assert.ok(Number.isFinite(macd.hist[last]));
  assert.equal(macd.dea.findIndex((v) => v != null), 33);
});
