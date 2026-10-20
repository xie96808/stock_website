// M-07: 今日挑战榜 — signed, red/green returns; nickname column usable on phones; title clear of ×.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDcReturn, dcReturnTone } from "../js/daily-challenge.js";

test("returns are signed", () => {
  assert.equal(formatDcReturn("13.05", 130537), "+13.05%");
  assert.equal(formatDcReturn("7.40", 73970), "+7.40%");
  assert.equal(formatDcReturn("-2.10", -21000), "-2.10%");
  assert.equal(formatDcReturn("0.00", 0), "0.00%");
  assert.equal(formatDcReturn(null, null), "—");
});

test("tone: gain red (positive), loss green (negative), flat neutral", () => {
  assert.equal(dcReturnTone(130537), "positive");
  assert.equal(dcReturnTone(-1), "negative");
  assert.equal(dcReturnTone(0), "");
  assert.equal(dcReturnTone(undefined), "");
});

test("css: tone colours use the shared gain/loss tokens; head leaves room for ×", () => {
  const css = readFileSync(new URL("../css/start.css", import.meta.url), "utf8");
  assert.match(css, /td\.dc-ret\.positive\s*\{\s*color:\s*var\(--gain-color\)/);
  assert.match(css, /td\.dc-ret\.negative\s*\{\s*color:\s*var\(--loss-color\)/);
  assert.match(css, /\.daily-challenge-board-modal \.daily-challenge-board-head\s*\{\s*padding-right:\s*48px/);
});
