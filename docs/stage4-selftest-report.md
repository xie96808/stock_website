# Stage 4 self-test report

Date: 2026-09-07 09:30 CST
Branch: `feat/leaderboard-stage4`
Base: `origin/main` @ Stage 3 merge (#31)
Scope: dual-mode public leaderboard — no admin UI / Stage 5 moderation endpoints.

## What landed

- Migration `003_leaderboard_indexes.sql`: board / eligible-result / opt-in indexes
- Service `server/src/lib/leaderboard.js`: board key `(rule_version, dataset_version, fill_mode)`; one seat per user (best `return_ppm`, earlier `finished_at`, then `game_id`); deterministic ranks; eligibility filters (`settled`, `validity=valid`, `leaderboard_hidden=0`, `trade_count>=1`, user `active` + `role=user` + `leaderboard_opt_in`)
- Public `GET /api/v1/leaderboard?fillMode=` (+ optional `ruleVersion` / `datasetVersion`): `top10` (nickname, avatarId, returnPpm/Pct, finishedAt, rank — no username), `myRank`, `ineligibilityReason`, `asOf`, versions
- Config feature flag `features.leaderboard: true`
- Frontend sketch-style page: home lane + `/#/leaderboard` hash route; guests can view; settings opt-in takes effect on next fetch
- Respects Stage 3 `game_results.validity` / `leaderboard_hidden` for Stage 5 hooks

## Automated tests

| Suite | Command | Result |
|---|---|---|
| Engine unit | `node --test tests/engine/engine.test.js` | **17/17 pass** |
| Games + auth + leaderboard | `node --test server/tests/*.integration.test.js` (via run-tests) | **25/25 pass** (auth 2 + games 15 + leaderboard 8) |
| Full harness run 1 | `node scripts/run-tests.mjs` | **all suites green** |
| Full harness run 2 | `node scripts/run-tests.mjs` | **all suites green** |

Leaderboard coverage:
1. Separate boards per `fill_mode`
2. Same user multi games → one seat (best)
3. `opt_in` false excluded; enable → appears immediately
4. Zero-buy (`trade_count=0`) not ranked
5. Top10 order + `myRank` when outside top10
6. Unauthenticated public read OK; no private fields; missing `fillMode` → 400
7. `leaderboard_hidden` / `validity=invalid` excluded
8. Config advertises leaderboard feature

## Residual risks

- Leaderboard SQL uses window functions on SQLite (3.49+ in better-sqlite3); fine for MVP single process; large boards may need EXPLAIN / tune later
- Public nicknames may collide; ranks remain unique by user seat / internal ordering
- Frontend hash route is lightweight (no full SPA router); deep-link only for leaderboard
- No Redis / materialised board — every request recomputes ranked seats (acceptable for Stage 4 scale)
- Stage 5 admin moderation UI still out of scope; columns are ready

## Explicit clearance

**P0: CLEAR** — required dual-board / seat / opt-in / zero-buy / top10+myRank / public-read cases green  
**P1: CLEAR** — hidden/invalid exclusion + config flag + full regression ×2 green  
