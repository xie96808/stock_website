# C2 — Game use-case / view separation

Status: Wave C · item 2 — **in progress** (slice 1 of N).

## Intent

Fold `game` / `game-sync` / `result` toward a clear **use-case** vs **view** split
without a big-bang rewrite. Prefer architecture quality over folder theater.

## Target boundaries

| Layer | Owns | Must not own |
|-------|------|--------------|
| **use-case** | start / resume / action / finish / abandon orchestration (cloud + local); session updates via `game-session` | DOM, chart chrome, HUD copy, screen routing |
| **view** | DOM / chart / HUD / result chrome wiring that **calls** use-cases | Engine settle math, cloud finish body shaping, illegal-action rules |
| **session seam** | `js/game-session.js` blackboard façade (already shipped) | Product orchestration |
| **engine** | `shared/engine.js` / `shared/puzzleEngine.js` pure replay/settle | Session / DOM |

## Today vs target (slice 1)

| Module | Today (after this PR) | Target |
|--------|----------------------|--------|
| `js/game-play-usecase.js` | **New** — local action / resume / settle + cloud finish body/patch helpers | Expand: start/seed orchestration, abandon, rewind orchestration without DOM |
| `js/game.js` | Still owns start seed, chart/HUD, rewind modal; **calls** use-case for action/resume/settle | Thin view: seed UI + call use-cases only |
| `js/game-sync.js` | HTTP create/finish/decision/rewind + save-status DOM; finish body/patch via use-case | Thinner adapter: HTTP + retry; status UI injected/callback; no session business rules |
| `js/result.js` | Result view + triggers `finishCloudGame` | Pure view: render `selectSettleView`; cloud finish invoked by settle use-case or explicit view hook |

## Slice 1 — what moved

### `js/game-play-usecase.js` (new)

| API | Role |
|-----|------|
| `validatePlayAction(session, action)` | Client illegal-action guards (pure) |
| `applyLocalDecision(action, { bars })` | Classic/puzzle mid-game replay → session (no DOM) |
| `applyServerDecisionState(state, { bars })` | event-v1 server state → classic session |
| `resumeLocalActions(actions, { bars })` | Draft resume replay (no DOM) |
| `settleLocalSession({ bars })` | Last-day settle → finished session fields |
| `applyPuzzleEngineResult` / `puzzlePositionFromState` | Puzzle mid/finish sync (was inline in `game.js`) |
| `buildCloudFinishBody(session)` | Finish request body + puzzle/event flags |
| `sessionPatchFromCloudFinish(data, { isPuzzle })` | Response → session patch bag |

### Call sites

- `js/game.js` — `handleAction` / `applyLocalAction` / `applyServerStateActions` / `applyCloudResume` / `finishSettle` call the use-case then paint HUD/chart/toast/`endGame`
- `js/game-sync.js` — `finishCloudGame` uses `buildCloudFinishBody` + `sessionPatchFromCloudFinish`

## Behaviors preserved

1. Classic local + cloud (legacy-batch + event-v1) action / settle
2. Puzzle action guards, settle, and finish response → stars / reward fields
3. Cloud draft resume invalid → stay day 1
4. Cloud finish retry / save-status UI still in `game-sync` (view-ish residue)

## Next C2 slices (not this PR)

1. Extract **start / seed** use-case from `startGame` (classic pack vs window DTO vs puzzle snapshot) — leave chart init in view
2. Thin `game-sync`: inject save-status UI callback; optionally move create/abandon orchestration beside play use-case
3. `result.js`: keep paint-only; ensure cloud finish is a single settle→persist hook with no analysis coupling
4. Rewind confirm: keep modal in view; move “may rewind / apply rewind state” into use-case

## Out of scope

- theme de-smuggle (Wave C §3)
- hindsight / quiz purification (Wave C §4)
- R5 API deploy, R6 follow-ups, React, folder theater
