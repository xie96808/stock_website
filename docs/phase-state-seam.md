# Architecture — game session state seam

Behavior-preserving refactor. **No intentional product behavior change**
(engine rules, scores/grades, K-line visuals, fill modes, auth, leaderboard,
pack content).

## Goal

Extract a clear boundary for **in-game session state** from the large
`gameState` blackboard so start / settle / share / analysis writers go through
a module API (`js/game-session.js`), improving extensibility and lowering
coupling. Façade-first (no big-bang property rename).

## What moved

### `js/game-session.js` (new)
Owns session lifecycle helpers:

| API | Role |
|-----|------|
| `getSession()` | Same object identity as `gameState` |
| `getStocksCatalog()` | `stocksData` (catalog, not session) |
| `resetSession({ practiceOnly, fillMode })` | Start-of-game field reset |
| `patchSession(partial)` | Session-key-only writes |
| `applyEngineResult(r, opts)` | Former `syncFromEngine` body |
| `clearShareMeta` / `setShareMeta` | Settlement share rank meta |
| `selectVisibleKline` / `selectGameWindow` / `selectTodayBar` | Live HUD / chart reads |
| `selectAnalysisInput` | Analysis adapter inputs |
| `selectSettleView` / `selectShareView` | Result / share hint reads |
| `SESSION_KEYS` / `snapshotSession` | Extension / tests |

### Call sites migrated (writers)
- `js/game.js` — `startGame` reset + cloud/local seed, resume/action patches, engine sync
- `js/game-sync.js` — cloud finish `saveStatus` / return fields
- `js/result-share.js` — `clearShareRankMeta` / rank meta set (compat wrappers kept)
- `js/analysis.js` — `bestPoints` / `bsScore` writes

### Call sites migrated (critical readers — P0 read-path)
- `js/game.js` — live HUD (`updateUI` / trade log / wave), chart (`updateChart` / OHLC),
  action/settle (`handleAction` / `finishSettle` / `getGameBars`) via `getSession()` +
  `selectVisibleKline` / `selectGameWindow` / `selectTodayBar`; catalog via `getStocksCatalog()`
- `js/analysis.js` — adapters read via `selectAnalysisInput()`
- `js/result.js` — settle/result render + result chart via `selectSettleView()` / `getSession()`
- `js/result-share.js` — share hint / promo / copy / sheet via `selectShareView()`

### Stayed on the blackboard
- `js/state.js` still exports `gameState`, `chartRefs`, `quizState`
- `stocksData` remains the pack catalog on `gameState` (not cleared by reset)
- Non-critical readers (hindsight / quiz / home chrome) may still import `gameState`
- `window.*` composition-root aliases unchanged (Phase 1 style)

## Intentionally not done
- Big-bang rename / nest (`gameState.session.*`)
- Merging `calcMANullPad` with `calculateMA`
- Unifying hindsight/quiz chart builders
- React, pack brotli/encoding, cross-device resume, seat materialization
- Changing engine rules or settlement math

## How to extend
1. Prefer `patchSession({ ... })` / `resetSession` / `applyEngineResult` for new
   **writes** to in-game fields.
2. Prefer `getSession()` / `select*` helpers for new **reads** in live game /
   analysis / result / share paths.
3. Add new session fields to `SESSION_KEYS` + `buildFreshSessionFields` defaults
   when they participate in start/reset.
4. Keep catalog / chrome / quiz state out of the session seam.

## Residual debt
- Hindsight / quiz / home IA and some sync helpers may still import `gameState`
  directly (out of P0 read-path scope).
- `startGame` still orchestrates DOM / chart / screen routing; state I/O is
  behind the seam.
- Share meta is still not cleared inside `resetSession` (matches historical
  `startGame`; cleared at settle via `clearShareRankMeta`).
- `addTradeHistory` remains a thin direct writer (compat); prefer engine sync.
- No field rename / nest (`gameState.session.*`) — façade identity preserved.

## Tests
- `tests/game-session.test.js` — identity, reset/catalog preserve, patch
  ignore-list, engine mid/finish invariants, share meta, **read selectors**
