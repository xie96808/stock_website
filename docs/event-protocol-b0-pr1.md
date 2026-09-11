# B0：事件协议 event-v1（PR1 + PR2）

Playability roadmap B0 底座。默认关闭，不影响现有批量 create／finish。

## Flag

| Env | Config | Default |
|-----|--------|---------|
| `EVENT_PROTOCOL_ENABLED=1` / `true` | `config.protocolEventV1Enabled` | **false** |

- Flag **OFF**：`POST /games`、`POST /games/:id/finish` 与今日完全一致；新列靠 SQL 默认值／NULL。`POST /games/:id/decisions` → `403 EVENT_PROTOCOL_DISABLED`。
- Flag **ON**：新开局签发 `protocol_version=event-v1`、`assist_class=clean`、`canonical_actions_json=[]`、`revision=0`；允许 advance 与 event-v1 finish。

`/api/v1/config` → `features.protocolEventV1`。

## Migrations

| File | Contents |
|------|----------|
| `009_event_protocol.sql` | `game_sessions` 协议列 + `game_commands` |
| `010_game_results_curve.sql` | `game_results`：`mdd_ppm`、`benchmark_return_ppm`、`equity_curve_json`、`score_version`、`assist_class`（均可空；旧成绩保持 NULL，不伪填 0） |

## API

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/games/:id/state` | 所有者；revision + 规范动作；**event-v1 只返回 `visible.history` + 已揭示 `visible.bars`（至 `revealedDay`），不含代码／名称／未来 bars** |
| POST | `/api/v1/games/:id/decisions` | `{ expectedRevision, action }` + `Idempotency-Key`；追加规范动作、revision+1；返回加深后的 state |
| POST | `/api/v1/games/:id/finish` | **legacy-batch**：原批量契约不变。**event-v1**：`{ expectedRevision, finish:true }` + `Idempotency-Key`；从服务端 `canonical_actions_json` 结算；客户端替换动作 → `409 SUBMISSION_CONFLICT`；写入曲线／MDD／基准 |

## Settle metrics（PRD §4.1）

实现：`shared/equityCurve.js`（`settleCurveMetrics`）。

- 每日收盘净值 E(t)，含 E(0)=100000；`mdd_ppm` 来自收盘回撤。
- `next_open`：第 t 日提交、次日开盘成交的订单**不**计入第 t 日收盘净值。
- 买入持有基准同撮合口径（next_open：第 2 日开盘买入，第 30 日收盘估值）。
- `score_version = sim30-mtm-curve-v1`；`assist_class` 从对局抄到结果行。

常量：`shared/protocol.js`。协议逻辑：`server/src/lib/gameProtocol.js`；结果 DTO：`gameResultDto.js`。

## 明确不在本阶段

每日同题、测验发币、反悔 UX、残局、榜单 assist 过滤、economy `reward_claims`、前端 hub 卡片（可 B0-PR3+）。

## 测试

```bash
node --test tests/engine/equity-curve.test.js
node --test server/tests/games.integration.test.js
node --test server/tests/event-protocol.integration.test.js
node --test server/tests/event-protocol-off.integration.test.js
npm test   # scripts/run-tests.mjs 已注册
```
