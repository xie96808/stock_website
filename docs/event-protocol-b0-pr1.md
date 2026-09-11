# B0-PR1：事件协议骨架（event-v1）

Playability roadmap B0 第一刀：**仅**协议字段迁移 + 开关 + 状态／决策骨架。默认关闭，不影响现有批量 create／finish。

## Flag

| Env | Config | Default |
|-----|--------|---------|
| `EVENT_PROTOCOL_ENABLED=1` / `true` | `config.protocolEventV1Enabled` | **false** |

- Flag **OFF**：`POST /games`、`POST /games/:id/finish` 与今日完全一致；新列靠 SQL 默认值填入。`POST /games/:id/decisions` → `403 EVENT_PROTOCOL_DISABLED`。
- Flag **ON**：新开局签发 `protocol_version=event-v1`、`assist_class=clean`、`canonical_actions_json=[]`、`revision=0`；允许薄 advance。

`/api/v1/config` → `features.protocolEventV1`。

## Migration

`server/migrations/009_event_protocol.sql`（接在 `008_jiu_coin.sql` 之后）

`game_sessions` 增量列（旧行安全默认）：

- `game_kind` default `classic`
- `protocol_version` default `legacy-batch`
- `revision` default `0`
- `undo_count` default `0`
- `assist_class` default `legacy`
- nullable：`challenge_id`、`puzzle_version_id`、`initial_state_json`、`canonical_actions_json`、`economy_version`

另建 `game_commands`（决策幂等与审计；本 PR 只写 `advance`）。

**未**扩展 `game_results` 的 MDD／曲线等（下一 B0 PR）。

## API（本 PR）

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/games/:id/state` | 所有者；revision + 规范动作 + 最小可见状态 |
| POST | `/api/v1/games/:id/decisions` | `{ expectedRevision, action }` + `Idempotency-Key`；引擎校验后追加一条并 +1 revision |

常量：`shared/protocol.js`。逻辑：`server/src/lib/gameProtocol.js`（避免继续膨胀 `games.js`）。

## 明确不在本 PR

每日同题、测验发币、反悔 UX、残局、榜单 assist 过滤、净值曲线／MDD、前端 hub 卡片、新协议 finish（仍走旧批量 finish）。

## 测试

```bash
node --test server/tests/games.integration.test.js
node --test server/tests/event-protocol.integration.test.js
npm test   # scripts/run-tests.mjs 已注册
```
