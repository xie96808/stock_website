// M-11: 「已有云端对局」copy matches what 继续 actually does, and keeps the stock hidden.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conflictProgressText } from "../js/resume-meta.js";

test("event-v1 without local draft resumes from cloud progress, not day 1", () => {
  const t = conflictProgressText({ decided: 0, draftDay: 0, protocolVersion: "event-v1", gameKind: "classic" });
  assert.equal(t, "本机暂无未提交进度，将按云端已提交的进度继续");
  assert.doesNotMatch(t, /第 1 日/);
});

test("legacy-batch (今日挑战) without draft still restarts from day 1", () => {
  assert.match(conflictProgressText({ draftDay: 0, protocolVersion: "legacy-batch", gameKind: "daily" }), /第 1 日/);
});

test("local draft wins", () => {
  assert.equal(conflictProgressText({ decided: 3, draftDay: 4, protocolVersion: "event-v1" }), "本机进度：已决策 3 日，将从第 4 日继续");
});

test("conflict view no longer prints stock name / code mid-game; protocolVersion is passed", () => {
  const src = readFileSync(new URL("../js/start-flow.js", import.meta.url), "utf8");
  const view = src.slice(src.indexOf("function showConflictView"), src.indexOf("let conflictResolver"));
  assert.doesNotMatch(view, /meta\.stockName|meta\.stockCode/);
  assert.match(src, /protocolVersion: active\.protocolVersion/);
});
