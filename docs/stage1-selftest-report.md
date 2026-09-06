# Stage 1 Self-test Report - feat/shared-engine-sim30-mtm

**Date:** 2026-09-06 (Asia/Shanghai)
**Branch / tip:** feat/shared-engine-sim30-mtm @ 030b3df (+ fix commits)
**PR:** https://github.com/xie96808/stock_website/pull/28 (open)

## What was tested

1. git fetch + checkout feat/shared-engine-sim30-mtm (no merge).
2. Full unit suite: node --test tests/engine/engine.test.js.
3. Extra Node smokes: next_open buy/sell, day29 buy->valuation, same_close RT, sell-when-flat, object action reject.
4. Spot-check index.html type=module, game.js imports shared/engine.js, day30 finishSettle, result.js no fake sell.

## Results

| Suite | Pass | Fail |
|---|---:|---:|
| tests/engine/engine.test.js | 17 | 0 |
| Extra smokes | all | 0 |

RULE_VERSION=sim30-mtm-v1. Actions are strings. Browser uses native ESM.

## Day-30 behavior

- After 29 decisions currentDay=30; only settle button.
- finishSettle calls settleGame(finish=true).
- Open lot valued at day30 close as valuation (not a sell).
- Empty book settles with no valuation.

## Bugs found / fixed

- js/result.js endGame used histLen before declaration (Stage-1 blocker). Fixed by declaring histLen from gameState.historyLength.

## Residual risks

- holdingDays edge cases not exhaustively fuzzed.
- ESM needs HTTP server (not file://).
- PR #28 still open; Stage2 stacks on Stage1 branch.

## Go / No-go for Stage 2

**GO** for Stage 2 account/session/avatars after histLen fix.
Do not start Stages 3-4 until Stage 2 auth MVP works locally.

