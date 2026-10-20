// M-08: 「我的战绩」列表每条标出玩法（统计卡只算经典局）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gameKindLabel } from "../js/my-games.js";

test("each game kind has a label; unknown/legacy rows read as classic", () => {
  assert.equal(gameKindLabel("classic"), "经典练习");
  assert.equal(gameKindLabel("oneshot"), "一把梭");
  assert.equal(gameKindLabel("survival"), "生存模式");
  assert.equal(gameKindLabel("daily"), "今日挑战");
  assert.equal(gameKindLabel("puzzle"), "残局");
  assert.equal(gameKindLabel(undefined), "经典练习");
});

test("list row meta renders the kind label before fill mode", () => {
  const src = readFileSync(new URL("../js/my-games.js", import.meta.url), "utf8");
  assert.match(src, /my-game-kind">\$\{escapeHtml\(gameKindLabel\(g\.gameKind\)\)\}<\/span> · \$\{g\.fillMode/);
});
