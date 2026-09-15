# F02 六关残局挑战首章

PRD §4.3。模拟盘 hub「残局挑战」：短窗口、初始持仓、星级与首通二星奖励。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `PUZZLE_CHAPTER_ENABLED=1`（或 `true`） | `config.puzzleChapterEnabled` | `features.puzzleChapter` |

- **默认 OFF**：`/api/v1/puzzles*` 返回 `404 PUZZLE_CHAPTER_DISABLED`；hub 卡片隐藏。
- **不要**在生产 deploy 配置里默认打开。

本地开启：

```bash
PUZZLE_CHAPTER_ENABLED=1 npm --prefix server start
```

## Migration / 种子

| File | Contents |
|------|----------|
| `server/migrations/014_puzzle_chapter.sql` | `puzzle_versions`、`puzzle_progress` |
| `seedPuzzleChapter1()` | 写入第一章 6 关 published **实盘选段**快照；已存在版本 id 不改写 |

关卡为 **v3 实盘 pack 窗口**（`data/stocks_data.json` 固定 `stockIndex` + `windowStartIndex`）。玩家侧股票代码掩码为 `******`（与经典局一致）；真实代码仅存 snapshot 供服务端审计。缺内容时列表/接口显示「准备中」，不随机编造坏关。

版本 bump 到 v3 后，生产需再跑一次 `seedPuzzleChapter1()`（`INSERT OR IGNORE` 写入 `puzzle:ch1-0x:v3`；列表取每关 `MAX(version)`）。

## 第一章六关（教研主题）

| 关 | 主题 | 开局提示 |
|----|------|----------|
| ch1-01 第一天站岗 | 买入后已有浮亏 | 开局已满仓浮亏，可卖可持 |
| ch1-02 到手的利润 | 初始持仓处于浮盈 | 开局满仓浮盈，可卖可持 |
| ch1-03 两笔机会 | 空仓、最多两笔成交 | 开局空仓，订单上限 2 笔 |
| ch1-04 明天才好卖 | 刚买入的 T+1 锁定 | 开局满仓且 T+1 锁定，首日不可卖 |
| ch1-05 震荡磨人 | 已有持仓、窄幅行情 | 开局满仓；震荡少动，上限 2 笔 |
| ch1-06 最后几个交易日 | 短窗末日估值 | 开局满仓，末日仅估值 |

每关附 `teachingBrief`（1～2 句中文）+ `openStateHint`，经 `GET /puzzles` 下发并显示在关卡列表。初始持仓均为残局刻意设定。

## 冻结规则（V1）

1. 单标的；空仓／满仓；固定 `next_open`；规则 id `puzzle-mtm-v1`；**不进经典榜**。
2. 初始状态：cash / qty / cost / buyFillDay / firstSellableDay，与 day1 open 接管净值一致；T+1 按成交日。
3. 窗口 6～10 日；前置约 30 根同标的历史 K；末日仅估值；决策次数 = days − 1。
4. 首局免费（`createFee=0`）；同 family 结算后再开扣 **10** 韭币（确认后入账）；登录存进度；无反悔。详见 `docs/puzzle-replay-economy-weekly.md`。
5. 星级：1★ 合法结算；2★ 主目标（如相对买入持有 +X pp）；3★ + MDD/订单约束。目标写在关卡配置。
6. 收益/MDD 相对接管 NAV；首次达 2★ +20（`puzzle:first-clear:<familyId>`，本章最多 120）；首次达 3★ +15（`puzzle:three-star:<familyId>`，独立）；更高星只更新纪录；版本 bump 不重置 family id。

## API（需 flag ON）

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/puzzles?chapter=ch1` | 可选 | 关卡列表 + 进度 + teachingBrief / openStateHint |
| POST | `/puzzles/:levelKey/entries` | 是 | 开局/恢复；费用 0；Idempotency-Key 可选 |
| POST | `/puzzles/games/:gameId/finish` | 是 | 短窗结算 + 星级 + 首通发币 |

## 前端

- 模拟盘 hub「残局挑战」**入口卡**（`index.html` + `js/puzzle-chapter.js` + `css/puzzle-chapter.css`）；flag 关闭则隐藏
- **关卡列表在独立全屏 `#puzzleScreen`**（返回模拟盘 hub），**不**在 hub 内联展开；章节进度条用 `GET /puzzles` 的 levels/stars
- 关卡行展示教学短文案 + 开局状态提示（满仓浮亏/浮盈/T+1/空仓等）+ 可读二星/三星条件
- 局内 HUD（`#puzzlePlayTip`）提醒开局状态与星级目标
- **局内 HUD 区分模拟盘**：`#gameScreen.game-screen--puzzle` + 顶栏徽章「残局」/「模拟盘」、关卡标题副标、窗口日 +「余 N 日」、资产/舞台 kicker 文案；经典局布局不变（`js/puzzle-goals-copy.js` → `formatPlayHudChrome`）
- Hub 左侧猫插画：左栏 `minmax(200px,340px)` + `.frame` 定宽 `min(100%,340px)` + `aspect-ratio: 3/4`（避免 absolute 图把左轨塌成 0）
- **开局后进入完整 `#gameScreen` 模拟盘**（与经典云局同一套 K 线 / 买卖观望 / 结算按钮）
  - `POST /puzzles/:levelKey/entries` 成功后调用 `startGame({ cloud })`（`window.__puzzleStartGame`）
  - 行情来自条目响应里的 **snapshot `bars` + `history`**（实盘短窗 + 约 30 根前置 K）；缺 `bars` 时抛错并恢复关卡列表 + toast
  - `ACTIVE_GAME_EXISTS`：确认框可选 **继续原局** 或 **放弃并开新局**；本地已走到末日的草稿会丢弃以免只能「结束并结算」
  - **无反悔**（`gameKind===puzzle` 隐藏 rewind）
  - 结算走 `POST /puzzles/games/:gameId/finish`，结果屏展示星级 / 首通韭币；**残局专属复盘**（对照买持、星级拆解、情境叙述）替换经典 BS/波段分析
- 非法动作：客户端禁用「已有持仓再买 / 空仓或 T+1 未到就卖」；服务端错误文案中文化（如「已有持仓，不能再买入」）
- **不**改动首页「悔棋局」hindsight 入口

## 数据集切片

- 经典局：`pickRandomWindow` 固定 `GAME_DAYS=30`
- 残局：`pickPuzzleWindow({ stockIndex, windowStartIndex, gameDays, historyLength })`（`server/src/lib/dataset.js`）

## 测试

```bash
node --test tests/engine/puzzle-engine.test.js
PUZZLE_CHAPTER_ENABLED=1 node --test server/tests/puzzle-chapter.integration.test.js
node --test server/tests/puzzle-chapter-off.integration.test.js
node scripts/run-tests.mjs
```

覆盖：资金守恒与 T+1、订单预算第三笔拒绝且不改状态、1/2/3 星、首通 +20 一次、重复/并发/版本 bump 不双发、仅 1★ 不发币、flag OFF。

## 第二章

见 `docs/puzzle-chapter-2.md`（同一 flag；独立 `ch2-*` family cap）。

## 内容缺口 / 风险（刻意延期）

- 局内已复用经典 `#gameScreen` + K 线（snapshot bars）；尚未做逐步 event-v1 服务端决策协议。
- 未做章节付费解锁、反悔、成就墙（F12）。
- 「显然占优」筛查跟进；第三/四章见 `docs/puzzle-chapter-3-4.md`。
