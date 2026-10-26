# 连续登录奖励

7 天循环，用户在首页「连续登录奖励」胶囊或每日首次弹出的卡片里**手动领取**（北京时间自然日，一天一次）。

| 第几天 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| 韭币 | 20 | 25 | 30 | 35 | 40 | 50 | 60 + 转盘 1 次* |

\* 转盘次数仅在「幸运转盘」开启时发放，7 天内有效。

- 昨天领过 → 进入下一天；第 7 天后回到第 1 天。
- 漏领 ≥1 天 → **只退一档**（`max(1, 上次天数 − 1)`），连续天数重新计，不清零，减少挫败感。
- 幂等：同一天重复/并发领取只发一次（`login_streak_claims` 主键 + 账本部分唯一索引），后面的返回 `409 ALREADY_CLAIMED_TODAY`。
- 机器人、已注销账号不能领取。

## 接口
- `GET /api/v1/me/streak` → `{ enabled:false }`，或 `{ enabled, today, claimedToday, day, runDays, bestRun, cyclesDone, broken, rewards[], next, balance }`
- `POST /api/v1/me/streak/claim` → `{ claimed:{ day, run, coins, spins, broken, balance }, state }`

## 开关
`LOGIN_STREAK_ENABLED=1`，或后台「功能开关」里的「连续登录奖励」（默认关）。关闭时首页不显示入口。改后台开关需要重启 API 才会被运行中的进程读到（设置在启动时加载）。

## 数据
迁移 `030_login_streak.sql`：`login_streaks`（进度）、`login_streak_claims`（每次领取的明细）。韭币走 `jiu_coin_ledger`，`reason = 'streak_claim'`，`ref_id = '<userId>:<YYYY-MM-DD>'`。

## 客户端
`js/login-streak.js`（入口与弹层）、`js/login-streak-pure.js`（纯函数，有单测）、`css/login-streak.css`。弹层复用公告弹窗外壳；每个自然日、每台设备最多自动弹一次，且等公告弹窗关闭之后再弹，不会盖住 PvP 房间。
