# B0-PR3：reward_claims 经济脚手架（B05）

PRD §6.3 / 任务 B05。只加表与同事务助手，**不**开启测验／残局／反悔等用户向发币。

## Migration

| File | Contents |
|------|----------|
| `011_reward_claims.sql` | `reward_claims`：`UNIQUE (user_id, reward_key)`、`amount > 0`、`economy_version`、`rule_version`、`ledger_id → jiu_coin_ledger` |

既有 `register_grant` / `daily_claim` / `game_create` 仍走 `008` 的 ledger 唯一索引，**不**迁入 `reward_claims`。

## Helper API（`server/src/lib/rewardClaims.js`）

| Export | 作用 |
|--------|------|
| `ECONOMY_VERSION` | 当前 `"economy-v1"`；规则表变更时递增并写入快照 |
| `grantRewardClaim(db, opts)` | 同事务：ledger(+amount) + balance + claim；幂等 |
| `deductRewardClaim(db, opts)` | 同事务：ledger(−amount) + balance + claim；不足抛 `INSUFFICIENT_FUNDS`；幂等 |
| `getRewardClaim(userId, rewardKey, db?)` | 读一条 claim |
| `hasRewardClaim(userId, rewardKey, db?)` | 是否已领 |

`opts`：`{ userId, rewardKey, amount, reason, economyVersion?, ruleVersion?, refType?, refId?, meta? }`。

- `amount` 必须是服务端正整数；非法 → `INVALID_REWARD_AMOUNT`（客户端金额不可信）。
- `rewardKey` 例：`quiz:2026-09-11`、`puzzle:first-clear:<rewardFamilyId>`、`game:<id>:rewind`。
- 返回：`{ unchanged, balance, claim, ledgerId }`。已存在 claim 时 `unchanged: true`，不二次改余额。
- 可嵌在外层 `db.transaction`（better-sqlite3 savepoint）。

## 明确不在本 PR

每日知识题 UI/API、每日同题、反悔、残局、外观、榜单 assist 过滤、默认打开 `EVENT_PROTOCOL`。

## 测试

```bash
node --test server/tests/reward-claims.integration.test.js
npm test   # scripts/run-tests.mjs 已注册
```
