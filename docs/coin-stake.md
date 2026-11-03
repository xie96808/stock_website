# 韭币局 + 韭币榜

Two features, both behind server flags that default **off** (`COIN_STAKE_ENABLED`, `COIN_BOARD_ENABLED`, also switchable in the admin settings page).
No monetisation is attached to either: 韭币 stays non-purchasable and non-cashable.

## 韭币局 (stake game)

A classic 30-day game played with the player's own coins instead of the fixed 20-coin entry fee.

| Rule | Value |
| --- | --- |
| Stake | whole coins, 10–500, chosen at create time |
| Entry fee | none — the stake is escrowed instead |
| Buys | unlimited (the engine only buys when flat: buy, sell, buy again) |
| Payout | `stake + profit − fee`; `profit = round(stake × return)` (half away from zero), `fee = floor(10% × profit)` only when `profit > 0` |
| Cap | none on the upside; the loss is at most the stake (`payout ≥ 0`) |
| Abandon / expiry | the escrow is not returned |
| Rewind / 后悔券 | not available |
| Boards | **on the 龙虎榜** (the old 练习榜) together with classic games: one board, one seat per player (best game / average over both kinds), no marker on the rows. Stake sessions are stored as `assist_class = 'clean'` (no rewind ⇒ 纯净), migration `039_stake_on_leaderboard.sql` backfills the older ones, and `/me/stats` + 「我的战绩」 use the same scope (`CLASSIC_BOARD_KINDS_SQL` in `server/src/lib/leaderboard.js`). The result page's board button opens the 龙虎榜; the 韭币榜 is opened from the 韭币 balance chip |

Because payouts are whole coins, a small stake with a small move can round to zero profit (10 coins at +4% → 0). The result card says so ("涨跌不足 1 韭币，本金原样退回").

### Server

* `shared/stake.js` — limits, `stakeSettlement`, settlement maths (shared with the client so the UI shows exactly what is paid).
* `server/migrations/036_coin_stake.sql` — rebuilds `game_sessions` with `'stake'` in the `game_kind` CHECK (all columns and indexes carried over), creates `coin_stakes`, and adds partial unique ledger indexes so a game can only escrow once and pay out once.
  `migrate.js` lists the file so foreign keys are off during the rebuild. Verified on a copy of the production database (row count, column list, index list and id set unchanged; `foreign_key_check` / `integrity_check` clean).
* `server/src/lib/coinStake.js` — `escrowStake` (inside the create TX, `INSUFFICIENT_FUNDS` with `required = stake`), `settleStake` (inside the finish TX of both the legacy and event-v1 paths; the `stake` object is also stored in the idempotent replay response), `forfeitStake`, `stakePublic`.
  An `open` stake whose game ended as `abandoned` / `expired` reads as `forfeited`, so the several expiry code paths don't each have to touch `coin_stakes`.
* `POST /api/v1/games { gameKind: "stake", stake: 10..500 }`. Errors: `FEATURE_DISABLED` (403), `INVALID_STAKE` (400), `INSUFFICIENT_FUNDS` (402).
* Game / result payloads gain `stake: { amount, status, [returnPpm, profit, fee, payout, net] }` for stake games only.
* Ledger reasons: `stake_escrow` (−stake), `stake_payout` (+payout).

### Client

* `开一局` on the home screen opens the stake picker when the feature is live; the start modal has a small「传统模式 · 固定 20 韭币开局 ▾」switch (and「← 回到韭币局」back). The play-modes sheet leads with the 韭币局 card and folds 经典练习 behind the same small toggle.
* The stake picker is a slot-machine cabinet (`css/coin-stake-picker.css`): three digit reels that roll when the amount changes (tap the reels to type a number), − / ＋ gold coins, one row of red chip presets (50 / 100 / 200 / 500; − / ＋ and the slider step by 10 from 10), and a 「预期本金加奖金总和」 panel showing the total paid back at +20% / −20%. Only two rules are printed: 开局不退 · 中途放弃不退. Reduced-motion users get no spinning / blinking.
* HUD shows `投入 N`; buying is limited only by the position (one holding at a time, T+1).
* Result screen shows 投入 / 盈亏 / 对局费 / 到账, and the top balance refreshes.
* A stake game in progress is resumable from the home banner (the coins are at stake).

## 开一局的界面皮肤（折中风格）

进场后的界面与结算页保持纸墨手绘底子，只在 `css/stake-play.css` 里加了「老虎机」点缀，且**只**在
`#gameScreen.game-screen--stake` / `#resultScreen.result-screen--stake` 下生效（`js/game.js`、`js/result.js` 按 stake 打开 class；
`tests/stake-play-skin.test.js` 断言每条规则都带这个作用域）：

- 收益率框 / 结算英雄卡：金色内线 + 一排跑马灯 + 收益率转轮窗（等宽字体，用重复渐变画格线，无 JS）。
- 收益率变化时数字像老虎机转轮一样逐位滚动、左边先停（`js/stake-reel-pure.js` 算转动计划，`js/stake-reel.js` 监听 `#rlCardPnl` / `#finalReturn`；
  元素的 textContent 始终等于显示的文字，滚动字符放在 `data-strip` 由 CSS 画出；`prefers-reduced-motion` 下不转）。
- 实时走势卡：只加金色内线，图表本身不动。
- 买入 / 卖出 / 观望 / 快进：用 CSS 画的街机按钮盖掉手绘贴图（旧规则有 `!important`，所以这里也要 `!important`），
  按下下陷 3px，不可用（已持仓 / T+1 / 结算中）变灰 + 虚线框。
- 白天 = 纸色；黑夜 = 现有墨色主题 + 偏暗的铜金。红涨绿跌沿用 `--gain-color` / `--loss-color`。
- HUD 徽章文案是「开一局」（`formatPlayHudChrome`）。韭币盈亏弹窗保持不变。

## 韭币榜

Opened by tapping the 韭币余额 chip at the top. `GET /api/v1/leaderboard/coins?board=balance|week`.

* **余额榜** — current balance, top 20.
* **本周净赚榜** — sum of ledger deltas since Monday 00:00 Asia/Shanghai for: `stake_escrow`, `stake_payout`, `pvp_entry`, `pvp_reward`, `pvp_refund`, `daily_claim`, `lucky_wheel` (coin prizes of the wheel), `streak_claim`, `quiz_daily_reward`. Registration / achievement / admin grants and shop purchases are not counted. Only positive totals are listed.
* Eligible = active, `role = 'user'`, `is_bot = 0`, `leaderboard_opt_in = 1`. Bots (10,000,000 balance), admins and opted-out players never appear.
* Public rows carry no user ids. The viewer gets `me` (rank/value, or a `reason`).
* 60 s in-memory cache (`COIN_BOARD_CACHE_TTL_MS`).
* The top three of the **balance** board get a 冠 / 亚 / 季 plaque on their avatar (`avatarMedal` next to `avatarFrame` in every avatar DTO: self, PvP faces, leaderboard rows, daily / puzzle boards). Client: `wrapAvatarHtml(img, frame, medal)` / `applyFrameToImg(img, frame, medal)`.

## Turning it on

Set `COIN_STAKE_ENABLED=1` / `COIN_BOARD_ENABLED=1` in the API env, or flip 「韭币局」/「韭币榜」 in the admin settings page (no restart needed). The static client adapts from `GET /config` → `features.coinStake` / `features.coinBoard`.

## Compliance note

Keep 韭币 non-purchasable and non-cashable. If coins are ever sold, use a separate wallet that cannot enter stake games, the boards or any exchange, and take legal advice first.
