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
| `seedPuzzleChapter1()` | 写入第一章 6 关 published 合成行情快照；已存在版本 id 不改写 |

关卡为 **synthetic OHLC** 骨架（可测 3★ 路线）。未绑定生产 pack 实盘选段；缺内容时列表/接口显示「准备中」，不随机编造坏关。

## 冻结规则（V1）

1. 单标的；空仓／满仓；固定 `next_open`；规则 id `puzzle-mtm-v1`；**不进经典榜**。
2. 初始状态：cash / qty / cost / buyFillDay / firstSellableDay，与 day1 open 接管净值一致；T+1 按成交日。
3. 窗口 6～10 日；末日仅估值；决策次数 = days − 1。
4. 第一章免费重玩（`createFee=0`，不走经典 −10）；登录存进度；无反悔。
5. 星级：1★ 合法结算；2★ 主目标（如相对买入持有 +X pp）；3★ + MDD/订单约束。目标写在关卡配置。
6. 收益/MDD 相对接管 NAV；首次达 2★ +20 韭币，`reward_key=puzzle:first-clear:<rewardFamilyId>`；本章每账号最多 120；更高星只更新纪录；版本 bump 不重置 family id。

## API（需 flag ON）

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/puzzles?chapter=ch1` | 可选 | 关卡列表 + 进度 |
| POST | `/puzzles/:levelKey/entries` | 是 | 开局/恢复；费用 0；Idempotency-Key 可选 |
| POST | `/puzzles/games/:gameId/finish` | 是 | 短窗结算 + 星级 + 首通发币 |

## 前端

- 模拟盘 hub「残局挑战」**入口卡**（`index.html` + `js/puzzle-chapter.js` + `css/puzzle-chapter.css`）；flag 关闭则隐藏
- **关卡列表在独立全屏 `#puzzleScreen`**（返回模拟盘 hub），**不**在 hub 内联展开；章节进度条用 `GET /puzzles` 的 levels/stars
- Hub 左侧猫插画保持自然 3:4，不随右侧内容被拉高（`css/start.css` `align-items: start`）
- **开局后进入完整 `#gameScreen` 模拟盘**（与经典云局同一套 K 线 / 买卖观望 / 结算按钮）
  - `POST /puzzles/:levelKey/entries` 成功后调用 `startGame({ cloud })`（`window.__puzzleStartGame`）
  - 行情来自条目响应里的 **snapshot `bars` + `history`**；缺 `bars` 时抛错并恢复关卡列表 + toast（避免卡在「开局中…」）
  - **无反悔**（`gameKind===puzzle` 隐藏 rewind）
  - 结算走 `POST /puzzles/games/:gameId/finish`，结果屏展示星级 / 首通韭币
- 非法动作：客户端禁用「已有持仓再买 / 空仓或 T+1 未到就卖」；服务端错误文案中文化（如「已有持仓，不能再买入」）
- **不**改动首页「悔棋局」hindsight 入口

## 测试

```bash
node --test tests/engine/puzzle-engine.test.js
PUZZLE_CHAPTER_ENABLED=1 node --test server/tests/puzzle-chapter.integration.test.js
node --test server/tests/puzzle-chapter-off.integration.test.js
node scripts/run-tests.mjs
```

覆盖：资金守恒与 T+1、订单预算第三笔拒绝且不改状态、1/2/3 星、首通 +20 一次、重复/并发/版本 bump 不双发、仅 1★ 不发币、flag OFF。

## 内容缺口 / 风险（刻意延期）

- 六关均为合成窗口，**非**生产 pack 实盘选段与教研解析。
- 局内已复用经典 `#gameScreen` + K 线（snapshot bars）；尚未做逐步 event-v1 服务端决策协议。
- 未做章节付费解锁、反悔、成就墙（F12）。
- 实盘可解性审计与「显然占优」筛查跟进。
