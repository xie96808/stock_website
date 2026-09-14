# R6 — Non-blocking ECharts

Status: Wave B · R6 (architecture restart handoff).

## Intent

ECharts used to ship as a **synchronous** `<script>` in `index.html` `<head>`, so
first paint / hub / start chrome competed with a large CDN download + parse.
Enter-game also gated on `waitForEcharts` before `startGame`, and chart
`init` / first `setOption` could hitch the main thread on screen switches.

R6 makes load / init / render **non-blocking for non-chart UI** while keeping
game / result / hindsight / academy quiz charts correct.

## What we chose (and why)

| Choice | Why |
| --- | --- |
| Remove sync `<script>` from `<head>` | Unblocks HTML parse + hub first paint. |
| `<link rel="preload" as="script">` only | Early fetch without executing or blocking parser. |
| Central `js/echarts-loader.js` | One place for CDN pin, fallback, status, DOM pending helpers. |
| Idle prefetch (`scheduleIdleEchartsPrefetch`) | Warm library after hub paints (~0.9s / `requestIdleCallback`), same spirit as pack warm. |
| `ensureEcharts()` at chart sites | Game / result / hindsight / quiz await just before `init`; hub/start never await. |
| Drop start-path `waitForEcharts` gate | Shell + fill-mode progress stay responsive; chart shows “图表加载中…” if CDN still in flight. |
| Double-rAF already on enter-game + **one more rAF** before first heavy `setOption` | Keeps chrome paint ahead of canvas work; trade-time `updateChart` stays sync for snappy buy/sell. |
| jsDelivr primary, unpkg fallback | Matches current CDN pin (`echarts@5.4.3`); retry without BootCDN (historically flaky). |

### Explicitly not chosen (this PR)

- Bundling ECharts into the repo / fingerprint pipeline (larger deploy surface).
- Dynamic `import()` of an ESM build (CDN UMD is what we already use; fewer surprises).
- Disposing every chart on every screen leave beyond existing hindsight/quiz dispose (game chart lifecycle unchanged).
- Worker / offscreen canvas (Wave C territory; measure first).

## Call sites

| Screen | Behavior |
| --- | --- |
| Hub / start | No ECharts await. Idle prefetch only. |
| Game | Paint shell → double rAF → `initChart` → `ensureEcharts` → init → rAF `setOption`. |
| Result | Settlement copy first; `drawResultChart` async + rAF paint. |
| Hindsight | Form UI first; `_drawChart` async ensure + rAF `setOption`. |
| Academy quiz (practical) | Ensure once per question; pending msg on mini charts. |

## Loading fallback

Chart hosts may show `.chart-pending-msg` via `data-chart-pending` /
`data-chart-failed` (styles in `css/game.css`). Cleared once `init` succeeds.

## Tests

- `tests/echarts-loader.test.js` — CDN pin, reuse global, inject attrs, fallback URL, DOM helpers.
- Full suite: `node scripts/run-tests.mjs`.

## Deploy notes

- **Static frontend only** (`index.html`, `js/echarts-loader.js`, chart callers, `css/game.css`, docs).
- **Do not** deploy API to server 29 for this PR.
- After static publish: cold load hub should paint before ECharts executes; first game may briefly show “图表加载中…” if prefetch lost the race (then chart appears).

## QA checklist

1. Cold refresh homepage / hub — UI interactive before network finishes ECharts (DevTools: no sync script in head; preload + later async script tag).
2. Start a cloud game — shell (day / cash / buttons) appears; K-line fills without a broken flash.
3. Settle — result numbers/copy appear; result K-line follows.
4. 悔棋局 — submit a query; chart renders.
5. 知识馆 practical quiz question — mini charts render.
6. Optional: throttle network, confirm pending copy then recovery; block CDN and confirm failure copy + unpkg fallback when jsDelivr fails.
