import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionLabel, lockedActionText } from "../../js/pvp/copy.js";

const root = new URL("../../", import.meta.url);

test("pvp action names are the trade-button words, never the raw code", () => {
  assert.equal(actionLabel("buy"), "买入");
  assert.equal(actionLabel("sell"), "卖出");
  assert.equal(actionLabel("hold"), "保持");
  assert.equal(actionLabel("BUY"), "买入");
  assert.equal(actionLabel("weird"), "");
  assert.equal(lockedActionText("buy"), "本手已提交：买入");
  assert.equal(lockedActionText("sell"), "本手已提交：卖出");
  assert.equal(lockedActionText("hold"), "本手已提交：保持");
  assert.equal(lockedActionText(null), "本手已提交");
  assert.equal(lockedActionText("weird"), "本手已提交");
});

test("pvp room shows the locked action through lockedActionText", () => {
  const room = readFileSync(new URL("js/pvp/room.js", root), "utf8");
  assert.match(room, /setText\("pvpActionError", lockedActionText\(view\.me\.lockedAction\)\)/);
  assert.doesNotMatch(room, /\$\{view\.me\.lockedAction\}/);
  const html = readFileSync(new URL("index.html", root), "utf8");
  assert.match(html, /class="pvp-sketch-label ctl-label">保持</, "hold button wording the label matches");
});
