# Architecture Phase 2 — domain purification

Behavior-preserving refactor. **No intentional product behavior change**
(scores, grades, best-points, K-line day-index axis, 开局第1天 mark, *日线
legends, fill modes, engine rules).

## What changed

### `js/analysis-pure.js`
Pure functions (no DOM / no `gameState`):
- `computeBestPoints`, `computeBSReport`, `computeKlineAnalysisModel`, `calcGrade`
- `calcMANullPad` — null-padded MA used by analysis scoring only

### `js/analysis.js`
Thin DOM adapters: read `gameState`, call pure layer, write `#klineAnalysis` /
`#bsReport` / `gameState.bestPoints` / `gameState.bsScore`.

### `js/kline-option.js`
Shared `buildKlineOption(viewModel)` used by live game chart and result review
chart. Preserves mode-specific series order, markLine, legend selected map,
and tooltip calendar dates.

### Phase 1 fix
Corrected broken `screen-router` import that had been inserted inside the
`result-share` import block in `js/result.js` (syntax error on `main`).

## Intentionally not merged
- `calcMANullPad` (analysis) vs `calculateMA` (charts) — different cold-start
  and rounding; merging would change scores or MA series numbers.
- Hindsight / quiz chart builders — left separate (higher risk / different UX).

## Out of scope
- React, `gameState` big rename, pack worker rewrite, Phase 0/brotli, engine
  rule changes, router re-do.

## Tests
- `tests/analysis-pure.test.js` — fixture snapshots for best-points / BS / grade
- `tests/kline-option.test.js` — day-index / 日线 / 开局第1天 structural checks
