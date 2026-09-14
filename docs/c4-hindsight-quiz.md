# C4 — Hindsight / Quiz purification

Status: Wave C · item 4 — **done**. Wave C **complete**.

## Intent

Reduce smuggling between hindsight, academy training quiz, shared blackboards
(`gameState` / `quizState` / `chartRefs`), and theme/chart chrome. Extract **pure**
scoring / window / validation helpers; keep DOM + ECharts in view modules.
Hindsight play/analyze and quiz answer flow must not poke game-session or theme
ad hoc (theme already owned by C3).

## Before (tangled)

| Site | Smell |
|------|--------|
| `js/hindsight.js` | Search / hands parse / date window / best-sell scoring / commodity math mixed with DOM + chart paint; read `gameState.stocksData` inside helpers |
| `js/quiz.js` | `trendScore` / `analyzeTechnical` / answer grading / result bands inline with DOM; practical generator closed over `gameState`; answer flow mutated `quizState` with scoring rules embedded |
| `js/state.js` | `quizState.charts` undocumented; easy to confuse with `chartRefs` (game/result) |
| Cross | No pure module to unit-test window/scoring without jsdom |

## After (ownership)

| Layer | Module | Owns |
|-------|--------|------|
| **Pure** | `js/hindsight-pure.js` | Stock match / hands parse / date+kline window / `findBestSellAfterBuy` / `computeHindsightAnalysis` / commodity affordances / `resolveHindsightWindow` |
| **View** | `js/hindsight.js` | Screen route, form DOM, chart paint, theme subscribe (`getTheme` / `onThemeChange`), pack load via `ensureStocksLoaded(gameState)` then pass stocks into pure |
| **Pure** | `js/quiz-pure.js` | `trendScore` / `analyzeTechnical` / normalize continuation / answer check / grade bands / session apply·advance / result details / `pickPracticalWindow(stocks)` |
| **View** | `js/quiz.js` | Question DOM, mini-charts on `quizState.charts`, theme retheme; calls pure for scoring/session; generators receive `stocks` arg |
| **Shell** | `js/academy.js` | Zone routing only; still calls `startQuiz` / `disposeQuizCharts` after pack load |
| **Blackboard** | `js/state.js` | `quizState` session fields + view-owned `charts`; `chartRefs` = game/result only |

### Hindsight pure APIs

- `stockMatches` / `findStockMatch` / `filterStocksByQuery` / `pinyinOf` / `normCode`
- `parseHands` / `validateDateRange` / `filterKlineWindow` / `resolveHindsightWindow`
- `findBestSellAfterBuy` / `computeHindsightAnalysis` / `commodityAffordances`

### Quiz pure APIs

- `trendScore` / `analyzeTechnical` / `normalizeContinuation` / `pickPracticalWindow`
- `isQuizAnswerCorrect` / `gradeQuizScore`
- `createEmptyQuizSession` / `applyQuizAnswer` / `advanceQuizSession` / `buildQuizResultDetails`

## Behaviors preserved

1. Hindsight stock search (name / code / pack py·jp / CHAR_PY fallback)
2. Hands validation (strict positive integer; reject `1e2` / decimals)
3. Date window + min-bars gate; best sell = highest **post-buy** high; range high = whole window
4. Commodity rows + 首付「多出」verb; earned label 最多赚 / 最少亏
5. Academy training quiz theory + practical generation, answer lock, score bands, result details
6. Theme retheme via C3 subscription only (no `game-session` writes from either flow)

## Out of scope

- Daily rewarded quiz HTTP (`js/daily-quiz.js` / F11) — separate path
- Broad QA / R5 API deploy to server 29
- React / folder theater / reopening C1–C3
