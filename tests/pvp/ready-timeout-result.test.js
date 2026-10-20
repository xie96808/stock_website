// M-13: a match aborted before any round (ready_timeout) hides 复盘分析 / 缩放提示 / 送礼.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/pvp/result.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function isUnplayedAbort"), src.indexOf("function paintAnalysis"));
const isUnplayedAbort = new Function(`${body.replace("export ", "")}; return isUnplayedAbort;`)();

test("isUnplayedAbort: only aborted matches with no resolved round", () => {
  assert.equal(isUnplayedAbort({ status: "aborted", resolvedRounds: 0, terminal: { reason: "ready_timeout" } }), true);
  assert.equal(isUnplayedAbort({ status: "aborted" }), true);
  assert.equal(isUnplayedAbort({ status: "aborted", resolvedRounds: 3 }), false);
  assert.equal(isUnplayedAbort({ status: "settled", resolvedRounds: 0 }), false);
  assert.equal(isUnplayedAbort(null), false);
});

test("analysis, pan hint and gifts are gated on isUnplayedAbort", () => {
  const pa = src.slice(src.indexOf("function paintAnalysis"));
  assert.match(pa.slice(0, 400), /if \(isUnplayedAbort\(view\)\) \{\s*node\.innerHTML = "";/);
  assert.match(src, /pan\.hidden = isUnplayedAbort\(view\)/);
  assert.match(src, /const canSend = !!view\?\.opponent\?\.userId && !!view\?\.matchId && !isUnplayedAbort\(view\);/);
});
