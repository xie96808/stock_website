// M-10: 「分享对战」shows 生成链接… while POST /pvp/shares is in flight, then restores.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/pvp/lobby.js", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("async function shareBattle"), src.indexOf("async function respond("));

test("pending label is set before the share request and restored in finally", () => {
  assert.match(src, /export const SHARE_PENDING_LABEL = "生成链接…"/);
  const setAt = fn.indexOf("label.textContent = SHARE_PENDING_LABEL");
  const reqAt = fn.indexOf("await getInvitePayload()");
  assert.ok(setAt > 0 && reqAt > setAt, "label set before awaiting the share");
  const fin = fn.slice(fn.indexOf("} finally {"));
  assert.match(fin, /label\.textContent = idleText/);
  assert.match(fin, /removeAttribute\("aria-busy"\)/);
  assert.match(fin, /button\.disabled = false/);
});

test("still disabled while pending (repeat taps stay deduped)", () => {
  assert.ok(fn.indexOf("button.disabled = true") < fn.indexOf("await getInvitePayload()"));
});

test("in-flight guard: repeat taps and lobby re-render do not start a second share", () => {
  assert.match(fn, /if \(sharePending\) return;\s*sharePending = true;/);
  assert.ok(fn.indexOf("sharePending = true") < fn.indexOf("await getInvitePayload()"));
  assert.match(fn.slice(fn.indexOf("} finally {")), /sharePending = false/);
  assert.match(src, /shareBtn\.disabled = !shareOk \|\| sharePending;/);
});
