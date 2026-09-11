# 韭币经济

登录用户的锁定货币：注册赠送、云端开局扣费、每日领取、管理端调整。游客可浏览模拟盘 hub / 知识馆 / 悔棋局 / 练习榜；「开始游戏」「我的战绩」需登录（打开右上角登录模态）。**无首页注册赠币宣传文案。**

## 规则（冻结）

| 动作 | 变化 | 说明 |
|------|------|------|
| 注册成功 | +500 | 与建号同事务；ledger `register_grant` |
| 迁移回填 | +1000 一次 | 仅对当时 `status=active` 用户；ledger `backfill_grant`（幂等唯一索引） |
| 云端 CREATE 成功 | −20 | 与 `game_sessions` INSERT 同事务；放弃不退；继续同一局不扣；幂等键重放不扣 |
| 每日领取 | +50～200（含端点，均匀） | 仅按钮；Asia/Shanghai 自然日一次；唯一 `(user_id, yyyy-mm-dd)` |
| 管理调整 | add / sub / set | 必填原因 + 审计 `jiu_coin.*` |

服务端强制余额；不足时 `402 INSUFFICIENT_FUNDS`；当日已领 `409 ALREADY_CLAIMED_TODAY`。

## Schema

- `server/migrations/008_jiu_coin.sql`：`users.jiu_coin_balance`、`jiu_coin_ledger`、`jiu_coin_daily_claims` + active 用户回填
- 库逻辑：`server/src/lib/jiuCoin.js`
- 通用奖励幂等（B0-PR3，尚无用户入口）：`server/migrations/011_reward_claims.sql` + `server/src/lib/rewardClaims.js` — 见 `docs/reward-claims-b0-pr3.md`

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/me` | `user.jiuCoinBalance` |
| GET | `/api/v1/me/jiu-coin` | `{ balance, date, claimedToday, amount? }` |
| POST | `/api/v1/me/jiu-coin/daily` | 每日领取 |
| POST | `/api/v1/games` | 成功 CREATE 扣 20；不足返回 `INSUFFICIENT_FUNDS` |
| GET | `/api/v1/admin/users/:id` | 含余额 |
| POST | `/api/v1/admin/users/:id/jiu-coin` | body `{ op, amount, reason }`（需 admin + reauth） |

## 前端

- 右上角 auth chip 旁：深绿硬币 SVG + 余额 +「每日领取」（登录可见）
- `js/start-flow.js`：未登录点「开始游戏」→ `openAuthModal('login')`；已移除本地/游客整局替代路径
- `js/my-games.js`：未登录同样打开登录模态
- 知识馆 / 悔棋局仍免登录

## 部署（server 29）

1. 发静态：`index.html`、`js/jiu-coin.js`、`js/start-flow.js`、`js/auth.js`、`css/jiu-coin.css`、`admin/` 等。
2. API 主机拉代码后 **migrate + 重启 API**：

```bash
# 示例：API 主机（server 29）
cd /path/to/api && sudo -u stockapi -E npm run migrate
# 应看到 applied 008_jiu_coin.sql（若尚未应用）
sudo systemctl restart stockgame-api   # 以实际 unit 名为准
```

3. 回填在 migrate 内一次完成；无需单独脚本。新注册走 `register_grant`，不会与 backfill 双发。

## 测试

```bash
npm test                 # 根目录：前端单测 + 会跑 scripts/run-tests.mjs
npm run test:server      # 含 server/tests/jiu-coin.integration.test.js
```

覆盖：注册赠送、回填幂等、CREATE 扣 20、再开再扣、resume/active 不扣、每日一次、管理调整、未登录 CREATE 拒绝。
