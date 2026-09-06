# Stage 3 self-test report

Date: 2026-09-06 23:56 CST
Branch: `feat/cloud-games-stage3`
Scope: cloud games (server-authoritative replay) — no leaderboard UI/API beyond result storage, no public admin.

## What landed

- Migration `002_game_sessions_results.sql`: `datasets`, `game_sessions`, `game_results`
- Dataset loader reads `data/stocks_data.json` (override `STOCKGAME_DATASET_PATH`); stamps `dataset_version` = file sha256
- APIs: `POST /games`, `GET /games/active`, `POST /games/:id/abandon`, `POST /games/:id/finish`, `GET /games/:id`, `GET /me/games`, `GET /me/stats`
- Finish replays from immutable `snapshot_json` via shared `settleGame` (`sim30-mtm-v1`); client `returnPct` ignored
- Frontend: cloud vs local practice in fill-mode modal; save status on result; My Games list + stats
- Guests: local practice only; copy does not promise saving guest games after login

## Automated tests

| Suite | Command | Result |
|---|---|---|
| Engine unit | `node --test tests/engine/engine.test.js` | **17/17 pass** |
| Games integration (P0+P1) | `node --test server/tests/games.integration.test.js` | **15/15 pass** (ran 3×) |
| Stage2 auth integration | `node --test server/tests/auth.integration.test.js` | **2/2 pass** |
| Combined server | `node --test server/tests/*.integration.test.js` | **17/17 pass** |

P0 coverage: auth required; next_open/same_close happy paths vs shared engine; idempotent create/finish; illegal sell → 422 still active; second active blocked + abandon; forged return ignored; foreign 404; day29 buy valuation; 29 holds 0%; conflicting finish 409.

P1 coverage: expired finish 410; dataset/rule stamped; me/games limit+cursor; concurrent identical finish single row.

Fixtures: `server/tests/fixtures/mini_stocks.json` with fixed `stockIndex`/`windowStartIndex` overrides (`STOCKGAME_ALLOW_PICK_OVERRIDE=1` in tests only).

## Residual risks

- Full production pack load on server start is heavy (~58MB JSON); acceptable for MVP single process; consider mmap/index later
- Frontend cloud create depends on same-origin API + CSRF; static GitHub Pages alone cannot save without API host
- Local practice still uses client-side random pick; only cloud path is server-authoritative
- No leaderboard endpoints (Stage 4); `leaderboard_hidden`/`validity` columns exist for later governance
- Average stats use JS `Math.round` on ppm mean (display); ranking not implemented here

## Explicit clearance

**P0: CLEAR** — all required P0 cases green  
**P1: CLEAR** — expired, version stamp, pagination, concurrent finish green  
