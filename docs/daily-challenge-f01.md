# F01 每日同题挑战（daily challenge）

PRD §4.1。模拟盘 hub「今日挑战」：全站同日同题、每日一次正式机会、次日开盘成交、禁用反悔；首期**不发名次韭币**（发币走 F11 知识挑战）。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `DAILY_CHALLENGE_ENABLED=1`（或 `true`） | `config.dailyChallengeEnabled` | `features.dailyChallenge` |

- **默认 OFF**：`/api/v1/daily-challenge*` 返回 `404 DAILY_CHALLENGE_DISABLED`；hub 卡片隐藏；经典开局/恢复/练习榜不变。
- **不要**在生产 deploy 配置里默认打开。

本地开启：

```bash
DAILY_CHALLENGE_ENABLED=1 npm --prefix server start
```

时钟注入（测试）：`STOCKGAME_NOW_MS=<epoch_ms>`。

## Migration / 种子

| File | Contents |
|------|----------|
| `server/migrations/013_daily_challenge.sql` | `daily_challenges`（不可变快照）、`daily_challenge_attempts`（每账号每日一次） |
| `seedNearDailyChallenges()` | 围绕上海日历日写入约 14 天 published 配置；已存在行永不改写 |

题目缺失时接口/UI：「今日挑战准备中」，保留经典入口。

## 冻结规则（V1）

1. Asia/Shanghai 自然日；周末开放；`opensAt` / `closesAt`（截止=次日 00:00:00 上海）。
2. 仅 `next_open`、初始资金 100000、30 日窗口。
3. 快照含行情段、规则版本、`market_hash`；数据集切换不改已发布日。
4. 成功创建：占机会 + 扣 10 韭币 + 建局 **同事务**；余额不足 / 已有活动局 / 失败 → 不占不扣。
5. 恢复不扣；放弃/过期保留已用机会不退。经典活动局冲突时由用户选择继续或放弃。
6. 正式局 `game_kind=daily`、`legacy-batch`、无反悔；仅首次准时结算进当日榜；V1 **不做**次日归档练习（follow-up）。
7. 截止前结算进榜；截止后结算记 `settle_late`；幂等重试返回原结果。
8. 无排名发币。
9. 截止前公共榜仅摘要；个人结算页可完整复盘。

计分：`return_ppm` 降序 → `mdd_ppm` 升序 → `DENSE_RANK`；买入持有基准同 `next_open` 口径；MDD 复用 `shared/equityCurve.js`。

## API（需 flag ON）

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/daily-challenge` | 可选 | 当日状态、剩余机会、活动局 |
| POST | `/daily-challenge/games` | 是 | 开局/恢复；Idempotency-Key 可选 |
| GET | `/daily-challenge/leaderboard` | 否 | 日榜；截止前脱敏 |

## 前端

- 模拟盘 hub「今日挑战」卡（`index.html` + `js/daily-challenge.js`）
- 读 `features.dailyChallenge`；关闭则隐藏
- 费用展示：数字 + 硬币图标（`amountWithCoinHtml`）

## 测试

```bash
DAILY_CHALLENGE_ENABLED=1 node --test server/tests/daily-challenge.integration.test.js
node scripts/run-tests.mjs
```

## Follow-ups（本 PR 刻意不做）

- 次日归档练习开局（仍耗 10、不改成绩）
- 分享图深度脱敏与专用分享卡
- event-v1 逐步决策协议（正式局不依赖 EVENT_PROTOCOL）
- 管理端选题发布台
