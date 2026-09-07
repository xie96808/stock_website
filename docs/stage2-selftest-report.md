# Stage 2 Self-test Report - origin/main

**Date:** 2026-09-06 (Asia/Shanghai)
**SHA tested:** `7aa29f1425b282dce70b1a98b5170c30760684ff` (main, merge of PR #29)
**Method:** temp SQLite, API on http://127.0.0.1:8787, fetch integration script; engine suite node --test.
**Branch:** `test/stage2-verification` (harness + report only; no Stage 3).

## P0 (must)

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | Register / login / logout | PASS | Register 201; login 200; logout 204 then /me 401 |
| 2 | Session cookie httpOnly; GET /api/v1/me | PASS | HttpOnly SameSite=Lax; /me 200 logged-in, 401 otherwise |
| 3 | PATCH /me nickname + avatar_id 1..12; dice path | PASS | Patch OK; 13 rejected; 1-12 OK; js/auth.js dice present |
| 4 | CSRF / same-origin on mutating routes | PASS | Missing/forged token 403 CSRF_FAILED; evil Origin 403 ORIGIN_DENIED |
| 5 | Password change invalidates old sessions | PASS | POST /me/password 204; old sessions 401; new login OK |
| 6 | Recovery code flow | PASS | Issued on register; implemented end-to-end (not stubbed) |
| 7 | Zodiac avatars 01.svg-12.svg serve 200 | PASS | 12/12 |
| 8 | Engine tests still green | PASS | 17/17 (no Stage1 regression) |

## P1 (nice-to-verify)

| Item | Result | Notes |
|---|---|---|
| Duplicate username rejected | PASS | 409 USERNAME_TAKEN |
| Weak/short password (<4) rejected | PASS | 400 INVALID_PASSWORD |
| leaderboard_opt_in default false | PASS | Register returns false |
| DELETE account / recover | PASS | Both implemented; DELETE needs confirmation=DELETE |

## Bugs found

None on main @ 7aa29f1. No fix PR required.

Harness added on this branch:
- `server/tests/stage2-auth.integration.mjs`
- root script `test:stage2-auth` (server must already be running)

## Residual risks

- Harness is two-step (start server with temp DB, then run script); not in CI yet.
- Dev cookies are non-Secure; production uses Secure + __Host- prefix.
- Login/register/recover rely on Origin allowlist; authenticated mutators also require CSRF header.

## GO / NO-GO for Stage 3

**GO** for Stage 3 cloud games/leaderboard from an auth/session/avatar standpoint.

This branch does not implement Stage 3.
