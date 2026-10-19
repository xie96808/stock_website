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

## 幸运转盘（Batch 0：服务端 + 后台，默认关闭）

`LUCKY_WHEEL_ENABLED`（默认 0，亦可在后台「开关/转盘」页切换）。**关闭时对玩家零变化**：`POST /me/jiu-coin/daily` 与 `GET /me/jiu-coin` 与此前完全一致。开启后每日领取返回 `410 DAILY_REPLACED_BY_WHEEL`，玩家改走转盘。设计见仓库外文档 DESIGN.md（Rev 2）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/me/lucky-wheel` | 状态：免费次数、8 个扇区（含 prizeId/art/isJackpot）、余额、`nextResetAt`；关闭时 `{enabled:false}` |
| POST | `/api/v1/me/lucky-wheel/spin` | 头 `Idempotency-Key`（8–128）必填；返回 `spinId, sector, landJitterDeg, prize{id,kind,amount/qty,coinValue,substituted,isJackpot}, isJackpot, balance, freeSpins, nextResetAt, replayed` |
| GET | `/api/v1/me/lucky-wheel/history` | 我的最近转盘记录 |
| GET/PUT | `/api/v1/admin/lucky-wheel[/config]`、POST `/config/preview` | 奖品表（EV 实时校验，须 60–250；权重和 10000）、版本、恢复 |
| GET | `/api/v1/admin/lucky-wheel/spins` / `/stats` | 记录（按用户/日期/价值筛选，游标分页）与统计（含实发/配置偏差） |
| POST | `/api/v1/admin/lucky-wheel/grant` | 发放转盘次数（需二次验证，写审计，可带 Idempotency-Key） |

- 结果在服务端以 `crypto.randomInt` 抽取，**一个 IMMEDIATE 事务**内完成：占免费位 → 抽奖 → `grantRewardClaim`（`reward_key = wheel:<spinId>`，ledger reason `lucky_wheel`）→ 记录。重放同一 `Idempotency-Key` 返回原结果（即便之后开关被关闭）。
- 自然日按 Asia/Shanghai（`nextResetAt` 为次日 00:00+08:00）；每日免费次数 `luckyWheelDailyFree`（1–5，默认 1）。切换当天已用旧「每日领取」的玩家，当天不再有免费转盘。
- 硬防线（DB）：`(user_id, spin_date, slot)` 唯一、`(user_id, idem_key)` 唯一、`reward_claims` 唯一、`jiu_coin_ledger(ref_id) WHERE reason='lucky_wheel'` 唯一；进程内限流仅为软防线。
- 表 A（上线）：纯韭币 90/300/50/150/70/**888**/110/200，权重 1800/700/1400/1400/2000/100/1600/1000，EV 125.68。表 B（后悔券 ×2/×3 + 再转一次）待 Track R 通过 `registerItemGranter()` 接入后由后台保存，无需再迁移。道具/再转扇区在道具不可用时按 `qty × 券折算值` 发韭币（记录 `substituted=1`）。
- 迁移 `026_lucky_wheel.sql` 仅新增表：`lucky_wheel_configs`、`lucky_wheel_spins`、`lucky_wheel_credit_grants` 与一个 ledger 唯一索引，不改任何既有表/数据。
- 测试：`server/tests/lucky-wheel.integration.test.js`。
