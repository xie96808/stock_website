# 一把梭（oneshot）— Phase A

单人规则变体：30 个交易日里最多 **1 买 + 1 卖**（观望不限）。不对战。

## Feature flag（默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `ONESHOT_MODE_ENABLED=1`（或 `true`） | `config.oneshotModeEnabled` | `features.oneshotMode` |

- **默认 OFF**：`POST /api/v1/games` 带 `gameKind=oneshot` 返回 `403 FEATURE_DISABLED`；三级卡片隐藏。
- 生产可在 `/etc/stockgame/api.env` 打开；需 **API + static** 同发（迁移 `016_oneshot_modifiers.sql`）。

本地开启：

```bash
EVENT_PROTOCOL_ENABLED=1 ONESHOT_MODE_ENABLED=1 npm --prefix server start
```

`features.survivalMode` 由 `SURVIVAL_MODE_ENABLED` 控制（Phase B，默认 OFF）。未知 `gameKind` → `400 INVALID_GAME_KIND`，不会静默当成 classic。

## Migration

| File | Contents |
|------|----------|
| `server/migrations/016_oneshot_modifiers.sql` | 重建 `game_sessions`：`game_kind` CHECK 含 `oneshot` / `survival`；可空 `modifiers TEXT`（JSON） |

`modifiers` 对一把梭：`{"maxBuys":1,"maxSells":1}`。SQLite TEXT，不是 jsonb。

## 规则

1. 费用 **30 韭币**（`JIU_COIN_ONESHOT_CREATE_COST`；经典仍为 `JIU_COIN_GAME_CREATE_COST=20`，今日挑战 50）。
2. 与经典共用 **ACTIVE 互斥**（`idx_game_sessions_one_active`）。
3. 服务端在 append decision / legacy finish 前校验买卖次数，超出 → `409 ORDER_LIMIT`；盘面不变。
4. 反悔关闭：`POST /games/:id/rewind` → `409 REWIND_NOT_ALLOWED`；HUD 无反悔按钮。
5. 成绩 **不进** 默认经典练习榜 / `me/stats`（查询钉 `game_kind=classic`）。独立一把梭榜：`GET /api/v1/leaderboard?gameKind=oneshot`（按收益率，与经典练习一致）。
6. 未买入结束 = 收益 0；买了没卖 = 持仓盯市到末日（引擎不变）。

## API

`POST /api/v1/games` body 增加可选 `gameKind`：

```json
{ "fillMode": "next_open", "gameKind": "oneshot" }
```

省略或 `"classic"` 仍为经典局（幂等 hash 与现网一致）。

## 入口

首页 → 进入模拟盘（L2）→ **选择玩法**（L3）：今日挑战 / 经典练习 / 一把梭。残局留在 L2 第二排。日榜仅 L3「查看日榜」弹窗。

## 测试

```bash
ONESHOT_MODE_ENABLED=1 EVENT_PROTOCOL_ENABLED=1 node --test server/tests/oneshot.integration.test.js
node --test server/tests/oneshot-off.integration.test.js
node scripts/run-tests.mjs
```
