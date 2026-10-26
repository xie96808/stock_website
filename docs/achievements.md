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
- Lifetime coin payout is ~3,400: a trickle, not a faucet.

## API
- `GET  /me/achievements` — `{items[], groups[], summary{total,claimed,claimable,claimableCoins,earnedCoins}, unlocks[], balance}`
- `POST /me/achievements/:key/claim` — 200 / 404 `UNKNOWN_ACHIEVEMENT` / 409 `NOT_REACHED` | `ALREADY_CLAIMED`
- `POST /me/achievements/claim-all` — pays every reached, unclaimed one in one transaction

## Adding one
Add an entry to `ACHIEVEMENTS` in `server/src/lib/achievements.js` (and a metric in `METRICS` if it needs new data).
Tiers of one metric must strictly increase in both target and coins (a test enforces it).

## Client
Home pill `#homeAch` (shares a row with the streak pill) → sheet reusing the announcements dialog shell.
`refreshAchievements({force:true})` runs after every cloud game save.
