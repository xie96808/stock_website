import test from "node:test";
import assert from "node:assert/strict";
import { colorReturnHtml, formatWindow, reasonLabel } from "../../js/pvp/copy.js";

test("yield percents are red when positive and green when negative", () => {
  const html = colorReturnHtml("涨了 +1.25%，跌了 -0.50%，平 0.00%，振幅 2.00%，位置 40%，亏损 3.00%，裸 8.50%");
  assert.equal(
    html,
    '涨了 <span class="pvp-up">+1.25%</span>，跌了 <span class="pvp-down">-0.50%</span>，平 0.00%，振幅 2.00%，位置 40%，亏损 3.00%，裸 <span class="pvp-up">8.50%</span>',
  );
});

test("a finished window names both ends and stays blank without them", () => {
  assert.equal(formatWindow({ periodStart: "2024-03-01", periodEnd: "2024-04-15" }), "2024-03-01 至 2024-04-15");
  assert.equal(formatWindow({ periodStart: "2024-03-01" }), "");
  assert.equal(formatWindow(null), "");
});

test("signed bare deltas are colored too", () => {
  const html = colorReturnHtml("段位 +12，掉了 -3，不动 0");
  assert.match(html, /pvp-up">\+12</);
  assert.match(html, /pvp-down">-3</);
  assert.doesNotMatch(html, /pvp-\w+">0</);
});

test("completed_return no longer says 收益决胜", () => {
  assert.equal(reasonLabel("completed_return"), "正常结束");
  assert.notEqual(reasonLabel("completed_return"), "收益决胜");
});
