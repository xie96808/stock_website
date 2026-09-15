# F02 残局挑战 · 第二章

延续 `docs/puzzle-chapter-f02.md` 冻结规则；同一 feature flag `PUZZLE_CHAPTER_ENABLED`。

## 种子 / 版本

| 项 | 说明 |
|----|------|
| `seedPuzzleChapter2()` / `seedAllPuzzleChapters()` | API boot（flag ON）幂等写入 `puzzle:ch2-0x:v1` |
| `chapter_id` | `ch2`；进度与首通奖励按章隔离 |
| 首通 | 2★ +20 韭币 / family；**本章 cap 120**（`ch2-01`…），不计入 ch1 |

生产部署后需再跑一次 seed（与 ch1 v4 相同：`INSERT OR IGNORE`；列表取 `MAX(version)`）。

## 第二章六关（教研主题）

| 关 | 标题 | 主题 | 开局 |
|----|------|------|------|
| ch2-01 | 追高吃套 | 追高后已套牢 | 满仓浮亏，宜早切 |
| ch2-02 | 割肉后的回马枪 | 空仓看反转 | 空仓，最多 2 笔 |
| ch2-03 | 一枪入场 | 仅一次满仓买入 | 空仓，整局 1 笔 |
| ch2-04 | 放量假突破 | 放量上攻失败 | 满仓假突破区 |
| ch2-05 | 阴跌阴跌再阴跌 | 缓慢阴跌止损 | 满仓阴跌市 |
| ch2-06 | 反弹逃顶 | 弱势反弹逃顶 | 满仓略浮亏，宜卖在反弹 |

相对第一章（站岗/浮盈/两笔/T+1/震荡/末日）进阶：追高、回补纪律、子弹次数约束、假突破、阴跌节奏、逃顶时机。星级目标均相对买入持有可分阶，买持不致直接 3★。

## API / UI

- `GET /puzzles?chapter=ch2` — 列表 + 本章进度 / 首通计数
- `POST /puzzles/:levelKey/entries`、`POST /puzzles/games/:gameId/finish` — 与第一章相同
- L3 章节菜单：第二章卡片开放；第三章仍「即将推出」
- 关卡屏标题「残局挑战 · 第二章」；返回 L3 章节选择

## 测试

```bash
node --test tests/puzzle-levels-history.test.js tests/puzzle-chapter-ui.test.js tests/home-ia-hub.test.js
PUZZLE_CHAPTER_ENABLED=1 node --test server/tests/puzzle-chapter.integration.test.js
node scripts/run-tests.mjs
```
