# F03 一次反悔 + 辅助分榜

PRD §4.2。新协议经典随机局每局限一次反悔（−50 韭币），成绩按 `assist_class` 分榜。

## Feature flags（均默认关闭）

| Env | Config | Client (`GET /api/v1/config` → `features`) |
|-----|--------|---------------------------------------------|
| `GAME_REWIND_ENABLED=1` / `true` | `config.gameRewindEnabled` | `features.gameRewind` |
| `EVENT_PROTOCOL_ENABLED=1` / `true` | `config.protocolEventV1Enabled` | `features.protocolEventV1` |

- **`GAME_REWIND` OFF**：`POST /games/:id/rewind` → `403 GAME_REWIND_DISABLED`；局内无反悔按钮；经典榜**不**按 `assistClass` 过滤（与今日一致）。
- **`EVENT_PROTOCOL` OFF**：新开局仍为 `legacy-batch`；反悔仅作用于**已经是** `event-v1` 的对局。本开关不因 F03 而默认打开。
- **完整 QA 路径**：本地需**两个 flag 同时打开**——先能签发 event-v1 并逐步 `decisions`，再测 rewind / 分榜。

本地示例：

```bash
EVENT_PROTOCOL_ENABLED=1 GAME_REWIND_ENABLED=1 npm --prefix server start
```

## 适用范围

- 仅 **新协议经典**随机局（`game_kind=classic` + `protocol_version=event-v1`），两种成交（`next_open` / `same_close`）。
- 不含：旧协议局、每日正式局（`daily`）、残局。
- 每局一次；固定 −50；开局费不退。
- 至少 1 条已提交规范决策；结算 / 放弃 / 过期后关闭入口。
- 第 29 条决策后待结算（已展示第 30 日、未揭晓身份）仍可反悔最后一条。

## API

| Method | Path | Body / Header | Notes |
|--------|------|---------------|-------|
| POST | `/api/v1/games/:id/rewind` | `{ expectedRevision }` + `Idempotency-Key` | 原子扣 50、回退规范动作、写 `game_commands`（type=`rewind`）、`assist_class=undo`、`undo_count=1` |

成功响应含 state 字段（revision / actions / visible / canRewind…）以及 `balanceBefore` / `balanceAfter` / `revokedAction` / `restoredDecisionDay` / `rewindCost`。

扣币：`deductRewardClaim`，`reward_key=game:<id>:rewind`，`reason=game_rewind`，金额 50。余额不足 → `402 INSUFFICIENT_FUNDS`，局内状态不变。同幂等键重试返回同一次结果。

## 辅助分类（按局，非按账号）

| `assist_class` | 含义 | 展示 |
|----------------|------|------|
| `clean` | 未用过反悔（含迁入的旧局） | 纯净 |
| `undo` | 用过反悔 | 反悔 |
| `legacy` | 历史残留值；迁移后经典未反悔局应已改为 `clean` | （不再单独做「历史练习」分榜） |

经典榜在 `GAME_REWIND` ON 时增加 **纯净 / 反悔 / 总榜** 切换；默认 **纯净 + 最佳**；保留两成交模式与 best/avg。反悔局不进入纯净平均值。

| Query | 含义 |
|-------|------|
| `assistClass=clean`（默认，flag ON 且省略时） | 仅 `clean` |
| `assistClass=undo` | 仅 `undo` |
| `assistClass=all` | **总榜** = 经典 `clean ∪ undo`（迁移后等价于全部可上榜经典辅助成绩） |
| `assistClass=legacy` | 仍可查询残留 `legacy` 行，UI 不再广告此 tab |

`GET /leaderboard?assistClass=clean|undo|all|legacy`；`GET /me/stats` 同样接受上述值（flag ON 时默认 clean）。

## 旧局迁入纯净

`server/migrations/015_assist_legacy_to_clean.sql`：

- `game_sessions`：`game_kind=classic` 且 `coalesce(undo_count,0)=0` 且 `assist_class IS NULL OR 'legacy'` → `clean`
- `game_results`：对应 `game_id` 上 `null/legacy` → `clean`
- **不**改 `undo_count=1` / `assist_class=undo` 行

部署后在 server 29 跑既有 migrate 流程即可（merge 后再迁 prod）。

## 实现位置

- `server/src/lib/gameRewind.js` — rewind 事务
- `server/src/lib/gameProtocol.js` — state `canRewind` / `rewindCost`
- `server/src/lib/leaderboard.js` — assist 过滤（含 `all`）
- `server/src/routes/games.js` — `POST .../rewind`、`features.gameRewind`
- 客户端：局内反悔按钮（琥珀黄）+ 确认弹窗；榜单辅助 tab；结果页辅助标记
- Migration：`015_assist_legacy_to_clean.sql`

## 测试

```bash
node --test server/tests/game-rewind.integration.test.js
node --test server/tests/game-rewind-off.integration.test.js
node scripts/run-tests.mjs
```

覆盖：余额 49 保留 / 50→0、双击幂等、第 1 / 第 29 决策回退、与 settle 竞态、T+1 再决策、分榜隔离（纯净 / 反悔 / 总榜）、flag OFF 行为。

## 明确不做

VPS 部署；强制打开 EVENT_PROTOCOL；虚构「原路线最终收益」复盘；每日局 / 残局反悔。旧局迁入纯净已由 `015` 完成（本条相对初版 F03 已收回）。
