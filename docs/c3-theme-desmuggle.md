# C3 — Theme 去偷渡（de-smuggle）

Status: Wave C · item 3 — **done**.

## Intent

Stop 纸/墨 (light/dark) theme from being smuggled through game / chart / result /
hindsight / quiz as ad-hoc DOM scrapes, `localStorage` re-reads, or side effects
inside `theme.js` that reach into `chartRefs` / `quizState`. Theme has one owner;
consumers subscribe or receive explicit tokens.

## Before (smuggled)

| Site | Smell |
|------|--------|
| `js/theme.js` | `toggleTheme` wrote DOM + storage, then **reached into** `chartRefs` + `quizState` to call `applyChartTheme` |
| `js/utils.js` | `getChartColors` / `applyChartTheme` scraped `document.documentElement[data-theme]` |
| `js/hindsight.js` | Independent `data-theme` scrape + local palette; unused `applyChartTheme` import |
| `js/theme.js` boot | Unrelated html2canvas preload + hindsight teaser date patch ran on theme import |
| Call sites | game / result / quiz called `applyChartTheme(chart)` with no explicit theme |

Early FOUC boot in `index.html` (inline `localStorage` → `data-theme` before paint)
stays intentional and outside the module graph.

## After (ownership)

| Layer | Module | Owns |
|-------|--------|------|
| **Owner** | `js/theme.js` | `getTheme` / `setTheme` / `toggleTheme` / `onThemeChange`; persist `theme` key; `documentElement[data-theme]`; `getChartColors(theme)` / `applyChartTheme(chart, theme)` |
| **Views** | `game.js` / `result.js` / `quiz.js` / `hindsight.js` | Subscribe via `onThemeChange`; paint/retheme **their** charts with explicit `theme` |
| **Utils** | `js/utils.js` | Chart math / MA / shuffle only — **no** theme |

### APIs (`js/theme.js`)

- `THEME_STORAGE_KEY`, `THEME_LIGHT`, `THEME_DARK`, `normalizeTheme`
- `getTheme()`, `setTheme(next)`, `toggleTheme(forced?)`
- `onThemeChange(listener)` → unsubscribe
- `getChartColors(theme?)`, `applyChartTheme(chart, theme?)`
- Test doubles: `__setThemeDepsForTests`, `__resetThemeForTests`

### Consumer pattern

```js
import { applyChartTheme, onThemeChange, getTheme } from './theme.js';

onThemeChange((theme) => {
  applyChartTheme(chartRefs.klineChart, theme);
});

// at paint time:
applyChartTheme(chartRefs.klineChart, getTheme());
```

Hindsight keeps a local `hindsightPalette(theme)` (line-chart tokens differ from
kline chrome) but reads theme only via `getTheme()` / `onThemeChange`.

## Behaviors preserved

1. Hub 纸 / 墨 pills still call `toggleTheme('light'|'dark')`
2. Preference persists in `localStorage.theme`
3. In-game kline, result review, quiz mini-charts retheme on change
4. Hindsight chart rethemes on change (previously missed by theme.js side effects)
5. FOUC-prevention inline script unchanged

## Out of scope

- Hindsight / quiz purification (Wave C §4)
- R5 API deploy to server 29
- React / folder theater
