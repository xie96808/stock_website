import test from "node:test";
import assert from "node:assert/strict";
import { colorReturnHtml } from "../../js/pvp/copy.js";

test("yield percents are red when positive and green when negative", () => {
  const html = colorReturnHtml("涨了 +1.25%，跌了 -0.50%，平 0.00%，振幅 2.00%，位置 40%，亏损 3.00%，裸 8.50%");
  assert.equal(
    html,
    '涨了 <span class="pvp-up">+1.25%</span>，跌了 <span class="pvp-down">-0.50%</span>，平 0.00%，振幅 2.00%，位置 40%，亏损 3.00%，裸 <span class="pvp-up">8.50%</span>',
  );
});
