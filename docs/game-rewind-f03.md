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
| `clean` | 新协议且 `undo_count=0` | 纯净 |
| `undo` | 新协议且用过反悔 | 反悔 |
| `legacy` | 旧协议 | 历史练习记录 |

经典榜在 `GAME_REWIND` ON 时增加纯净 / 反悔 / 历史切换；默认 **纯净 + 最佳**；保留两成交模式与 best/avg。反悔局不进入纯净平均值。`GET /leaderboard?assistClass=clean|undo|legacy`；`GET /me/stats` 同样接受 `assistClass`（flag ON 时默认 clean）。

## 实现位置

- `server/src/lib/gameRewind.js` — rewind 事务
- `server/src/lib/gameProtocol.js` — state `canRewind` / `rewindCost`
- `server/src/lib/leaderboard.js` — assist 过滤
- `server/src/routes/games.js` — `POST .../rewind`、`features.gameRewind`
- 客户端：局内反悔按钮 + 确认弹窗；榜单辅助 tab；结果页辅助标记
- 无新 migration（复用 `009` 列 + `game_commands` + `reward_claims`）

## 测试

```bash
node --test server/tests/game-rewind.integration.test.js
node --test server/tests/game-rewind-off.integration.test.js
node scripts/run-tests.mjs
```

覆盖：余额 49 保留 / 50→0、双击幂等、第 1 / 第 29 决策回退、与 settle 竞态、T+1 再决策、分榜隔离、flag OFF 行为。

## 明确不做

VPS 部署；强制打开 EVENT_PROTOCOL；旧局迁入纯净榜；虚构「原路线最终收益」复盘；每日局 / 残局反悔。
