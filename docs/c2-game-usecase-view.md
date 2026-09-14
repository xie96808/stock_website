# C2 — Game use-case / view separation

Status: Wave C · item 2 — **done**.

## Intent

Fold `game` / `game-sync` / `result` toward a clear **use-case** vs **view** split
without a big-bang rewrite. Prefer architecture quality over folder theater.

## Target boundaries

| Layer | Owns | Must not own |
|-------|------|--------------|
| **use-case** | start / resume / action / finish / abandon / rewind orchestration (cloud + local); session updates via `game-session` | DOM, chart chrome, HUD copy, screen routing |
| **view** | DOM / chart / HUD / result chrome wiring that **calls** use-cases | Engine settle math, cloud finish body shaping, illegal-action rules, seed math |
| **session seam** | `js/game-session.js` blackboard façade (already shipped) | Product orchestration |
| **engine** | `shared/engine.js` / `shared/puzzleEngine.js` pure replay/settle | Session / DOM |
| **HTTP adapter** | `js/game-sync.js` create/finish/decision/rewind + retry; injectable save-status UI | Seed / settle / rewind eligibility rules |

## Module map (complete)

| Module | Role |
|--------|------|
| `js/game-play-usecase.js` | Seed (puzzle / window / pack / local), action / resume / settle, rewind eligibility+apply, cloud finish body/patch, create/abandon/persist orchestration hooks |
| `js/game.js` | View: `startGame` calls `prepareSessionSeed` then paints screens/chart/HUD; action/resume/settle/rewind confirm call use-case then paint |
| `js/game-sync.js` | HTTP + retry; `setSaveStatusUiHandler` / default `paintCloudSaveStatus`; finish uses use-case body/patch helpers |
| `js/result.js` | Paint-only settle chrome / share / review; cloud save via `persistSettledCloudGame({ finishCloud })` |
| `js/start-flow.js` | Modal / progress UI; create/abandon go through use-case hooks with HTTP injected from game-sync |
| `js/game-window-seed.js` | R5 classic window DTO seed (called from use-case) |

## Use-case API surface

### Play / settle (slice 1 + kept)

| API | Role |
|-----|------|
| `validatePlayAction` / `applyLocalDecision` / `applyServerDecisionState` | Guards + mid-game replay |
| `resumeLocalActions` / `settleLocalSession` | Draft resume + last-day settle |
| `applyPuzzleEngineResult` / `puzzlePositionFromState` | Puzzle mid/finish sync |
| `buildCloudFinishBody` / `sessionPatchFromCloudFinish` | Finish request/response shaping |

### Start / seed

| API | Role |
|-----|------|
| `detectSeedKind` | `puzzle` / `window` / `pack` / `local` |
| `seedPuzzleSession` / `seedClassicFromPack` / `seedLocalPractice` | Individual seed paths |
| `prepareSessionSeed` | `resetSession` + choose seed path (no chart) |

### Rewind

| API | Role |
|-----|------|
| `evaluateRewindEligibility` | Flag + protocol + once + actions window |
| `buildRewindPreview` | Cost / balance / target day for confirm modal |
| `applyRewindServerResult` | Server rewind state → session |

### Cloud lifecycle hooks

| API | Role |
|-----|------|
| `shouldPersistCloudSettle` / `persistSettledCloudGame` | Single settle→persist entry (inject `finishCloud`) |
| `createCloudSession` / `abandonCloudSession` | Create/abandon + draft clear (inject HTTP) |

## Behaviors preserved

1. Classic local + cloud (legacy-batch + event-v1) action / settle
2. Puzzle action guards, settle, stars modal, cloud finish
3. Cloud draft resume invalid → stay day 1
4. R5 GameWindowDTO seed without full pack
5. Create / ACTIVE_GAME conflict continue|restart|abandon
6. F03 rewind confirm modal + once-per-game apply when flag on
7. Result paint + cloud save-status / share refresh after finish

## Out of scope (later Wave C)

- theme de-smuggle (Wave C §3)
- hindsight / quiz purification (Wave C §4)
- React, folder theater, R5 API deploy to server 29
