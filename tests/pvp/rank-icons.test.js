import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  rankIconPath,
  rankIconPathForTitle,
  rankIconSlug,
  titleForRating,
  RANK_GROUPS,
  RANK_ICON_SLUGS,
  PVP_RATING_FLOOR,
} from "../../shared/pvpRating.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("five rank groups map to distinct icon slugs and files", () => {
  assert.equal(RANK_GROUPS.length, 5);
  assert.equal(RANK_ICON_SLUGS.length, 5);
  for (const slug of RANK_ICON_SLUGS) {
    const path = join(root, `assets/pvp/rank-icons/rank-${slug}.png`);
    assert.equal(existsSync(path), true, `missing ${path}`);
  }
});

test("titleForRating exposes iconPath for each group", () => {
  // level bands: 700–999 韭菜, 1000–1299 散户, 1300–1599 股民老手, 1600–1899 游资, 1900+ 庄家
  const samples = [
    [PVP_RATING_FLOOR, "jiucai"],
    [1000, "sanhu"],
    [1300, "laoshou"],
    [1600, "youzi"],
    [1900, "zhuangjia"],
  ];
  for (const [rating, slug] of samples) {
    const title = titleForRating(rating, 20);
    assert.equal(rankIconSlug(rating), slug);
    assert.equal(title.iconSlug, slug);
    assert.equal(title.iconPath, `assets/pvp/rank-icons/rank-${slug}.png`);
    assert.equal(rankIconPath(rating), title.iconPath);
    assert.equal(rankIconPathForTitle(title.name), title.iconPath);
  }
});

test("rankIconPathForTitle matches group prefix", () => {
  assert.equal(rankIconPathForTitle("韭菜三段"), "assets/pvp/rank-icons/rank-jiucai.png");
  assert.equal(rankIconPathForTitle("股民老手二段 · 定级中"), "assets/pvp/rank-icons/rank-laoshou.png");
  assert.equal(rankIconPathForTitle("未知"), "assets/pvp/rank-icons/rank-sanhu.png");
});
