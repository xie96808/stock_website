# F02 残局挑战 · 第三章 + 第四章

延续 `docs/puzzle-chapter-f02.md` / `docs/puzzle-chapter-2.md` 冻结规则；同一 feature flag `PUZZLE_CHAPTER_ENABLED`。

## 种子 / 版本

| 项 | 说明 |
|----|------|
| `seedPuzzleChapter3()` / `seedPuzzleChapter4()` / `seedAllPuzzleChapters()` | API boot（flag ON）幂等写入 `puzzle:ch3-0x:v1` / `puzzle:ch4-0x:v1` |
| `chapter_id` | `ch3` / `ch4`；进度与首通奖励按章隔离 |
| 首通 | 2★ +20 韭币 / family；**每章 cap 120**（`ch3-01`… / `ch4-01`…），互不计入 |

生产部署后需再跑一次 seed（与 ch1/ch2 相同：`INSERT OR IGNORE`；列表取 `MAX(version)`）。

## 第三章六关（教研主题）

| 关 | 标题 | 主题 | 开局 |
|----|------|------|------|
| ch3-01 | 缺口情绪 | 高开缺口后的情绪追涨 | 满仓缺口追涨成本，宜早切 |
| ch3-02 | 支撑位保卫战 | 支撑失守时保卫或止损 | 满仓贴近支撑 |
| ch3-03 | 诱多陷阱 | 强势之后的诱多砸盘 | 满仓强势末端 |
| ch3-04 | 缩量阴跌 | 缩量阴跌止损节奏 | 满仓缩量阴跌市 |
| ch3-05 | 半仓试错 | 试错入场后的加/撤 | 空仓，最多 2 笔 |
| ch3-06 | 末日抉择 | 短窗末日卖或留 | 满仓短窗波动 |

## 第四章六关（进阶主题）

| 关 | 标题 | 主题 | 开局 |
|----|------|------|------|
| ch4-01 | 涨停次日 | 涨停次日去留 | 满仓涨停成本 |
| ch4-02 | 假摔回补 | 洗盘假摔后回补 | 空仓，最多 2 笔 |
| ch4-03 | 趋势回撤买点 | 上升趋势回撤买点 | 空仓，最多 2 笔 |
| ch4-04 | 双顶逃命 | 双顶附近逃顶 | 满仓双顶区 |
| ch4-05 | 消息真空磨人 | 消息真空后震荡 | 满仓震荡，上限 2 笔 |
| ch4-06 | 利润回吐纪律 | 浮盈回吐落袋 | 满仓已有浮盈 |

相对前两章进阶：缺口情绪、支撑保卫、诱多、缩量、试错节奏、末日择时；以及涨停次日、假摔回补、趋势回撤、双顶、消息真空、回吐纪律。星级目标均相对买入持有可分阶，买持不致直接 3★。代码掩码 `******`；奖励家族 `ch3-*` / `ch4-*`。

## API / UI

- `GET /puzzles?chapter=ch3|ch4` — 列表 + 本章进度 / 首通计数
- L3 章节菜单：第三、四章卡片开放（四章同屏）
- 同题周榜选题池：published `ch1+ch2+ch3+ch4`（按 `levelKey` 升序哈希取模）

## 测试

```bash
node --test tests/puzzle-levels-history.test.js tests/puzzle-chapter-ui.test.js tests/home-ia-hub.test.js
PUZZLE_CHAPTER_ENABLED=1 node --test server/tests/puzzle-chapter.integration.test.js
node scripts/run-tests.mjs
```

## 部署后

```bash
# flag 已开时 boot 会 seedAll；亦可显式：
# node -e "…" seedPuzzleChapter3/4
curl -sS 'https://<host>/api/v1/puzzles?chapter=ch3' | jq '.data.levels|length'  # → 6
curl -sS 'https://<host>/api/v1/puzzles?chapter=ch4' | jq '.data.levels|length'  # → 6
```
