# 成就

Flag: `achievementsEnabled` (env `ACHIEVEMENTS_ENABLED=1`, or admin 功能开关). Default **off**.
Off ⇒ `GET /me/achievements` → `{enabled:false}`, claims are `FEATURE_DISABLED`, the home pill and sheet stay hidden.

## Model
- Progress is **derived from live data** (settled games, daily challenge, puzzle, PvP, login streak, quiz, wheel, invites),
  so players are credited for what they already did. Nothing is written until they tap **领取**.
- A row in `user_achievements` = claimed. Coins go through `jiu_coin_ledger` (`achievement_claim`, ref_id `<uid>:<key>`,
  unique partial index) — a double tap / second tab gets `409 ALREADY_CLAIMED`.
- `unlock_key` on the row (e.g. `frame:laurel`) is what the avatar-frame shop reads
  (`getAchievementUnlocks(userId)`), so frames no shop sells can still be earned.
- Lifetime coin payout is ~16,300 across 41 achievements (v2). Habit / social tiers are priced well above the plain
  login income (a 7-day streak cycle pays 260, daily claim ~125/day) so that staying and inviting clearly pay off:
  `streak_3/7/14/30/100` = 60/200/400/1000/4000, `invite_1/5/20` = 150/600/2500, `quiz_30` = 400.
- Already-claimed rows keep the coins they were paid at claim time (no retroactive top-up).

## API
- `GET  /me/achievements` — `{items[], groups[], summary{total,claimed,claimable,claimableCoins,earnedCoins}, unlocks[], balance}`
- `POST /me/achievements/:key/claim` — 200 / 404 `UNKNOWN_ACHIEVEMENT` / 409 `NOT_REACHED` | `ALREADY_CLAIMED`
- `POST /me/achievements/claim-all` — pays every reached, unclaimed one in one transaction

## 高手 group (quality of play)
Counts only *qualifying* games: settled, valid, at least one trade, and not played with 悔棋 (`assist_class = 'undo'`).
Legacy rows without `mdd_ppm` / `benchmark_return_ppm` never count for the drawdown / benchmark tiers.
- `avgReturnPct` — average return (whole %, floor) once ≥ 10 qualifying games: `avg_2/5/8`
- `ddProfit10` / `ddProfit5` — profitable games with max drawdown ≤ 10% / 5%: `dd10_1`, `dd5_1`, `dd5_10`
- `calmBigWins` — return ≥ +20% with drawdown ≤ 5%: `calm_20`
- `beatBenchmark` — profitable and better than buy-and-hold of the same stock/window: `beat_1/10/30`
- `bestWinStreak` — longest run of consecutive profitable qualifying games: `wstreak_3/5/8`

## Adding one
Add an entry to `ACHIEVEMENTS` in `server/src/lib/achievements.js` (and a metric in `METRICS` if it needs new data).
Tiers of one metric must strictly increase in both target and coins (a test enforces it).

## Client
Home pill `#homeAch` (shares a row with the streak pill) → sheet reusing the announcements dialog shell.
Groups are accordions, all folded on open (a badge shows how many are claimable); opened groups stay open across repaints.
`refreshAchievements({force:true})` runs after every cloud game save.
