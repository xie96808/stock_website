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
| Boards | not on the 练习榜 (the board queries filter `game_kind = 'classic'`) |

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

## 韭币榜

Opened by tapping the 韭币余额 chip at the top. `GET /api/v1/leaderboard/coins?board=balance|week`.

* **余额榜** — current balance, top 20.
* **本周净赚榜** — sum of ledger deltas since Monday 00:00 Asia/Shanghai for: `stake_escrow`, `stake_payout`, `pvp_entry`, `pvp_reward`, `pvp_refund`, `daily_claim`, `wheel_prize`, `streak_claim`, `quiz_daily_reward`. Registration / achievement / admin grants and shop purchases are not counted. Only positive totals are listed.
* Eligible = active, `role = 'user'`, `is_bot = 0`, `leaderboard_opt_in = 1`. Bots (10,000,000 balance), admins and opted-out players never appear.
* Public rows carry no user ids. The viewer gets `me` (rank/value, or a `reason`).
* 60 s in-memory cache (`COIN_BOARD_CACHE_TTL_MS`).
* The top three of the **balance** board get a 冠 / 亚 / 季 plaque on their avatar (`avatarMedal` next to `avatarFrame` in every avatar DTO: self, PvP faces, leaderboard rows, daily / puzzle boards). Client: `wrapAvatarHtml(img, frame, medal)` / `applyFrameToImg(img, frame, medal)`.

## Turning it on

Set `COIN_STAKE_ENABLED=1` / `COIN_BOARD_ENABLED=1` in the API env, or flip 「韭币局」/「韭币榜」 in the admin settings page (no restart needed). The static client adapts from `GET /config` → `features.coinStake` / `features.coinBoard`.

## Compliance note

Keep 韭币 non-purchasable and non-cashable. If coins are ever sold, use a separate wallet that cannot enter stake games, the boards or any exchange, and take legal advice first.
