# Architecture Phase 1 — shell decoupling

Behavior-preserving refactor. **No intentional product behavior change**
(gameplay, rules, API contracts, password min 4, leaderboard metrics,
cloud resume/share, mobile sticky actions).

## What changed

### Unified screen router (`js/screen-router.js`)
- Single hide/show protocol helper: `prepareScreen` / `activateScreen` /
  `hideTopLevelScreens` / `setHeaderChrome`.
- Collapses prior copy-pasted `hideOtherScreens` (leaderboard, my-games) and
  `hidePeerScreens` (home-ia).
- **One** `hashchange` owner via `initAppHashRouting` + `registerHashRoute`
  (composition root in `index.html`). Replaces dual listeners in
  `home-ia.js` + `leaderboard.js` that ignored each other.
- Hash map (unchanged UX): `""|home` → home, `sim`, `academy|knowledge`,
  `hindsight|harmony`, `leaderboard`. `my-games` / game / result stay unhashed.
- Button entry to academy/hindsight still does **not** rewrite the hash
  (same as before). Deep links still work.

### Split `load-stocks.js`
| Module | Responsibility |
|--------|----------------|
| `js/pack-store.js` | fetch / IDB / worker / ensure / prefetch |
| `js/start-flow.js` | fill-mode modal, progress, cloud create ∥ pack ensure, `ACTIVE_GAME` continue/restart, then real `startGame` |
| `js/load-stocks.js` | thin compatibility barrel re-exporting both |

`attachDeferredStart` still assigns `window.startGame` as the modal wrapper
so `playAgain` and HTML `onclick` keep working. Other `window.*` aliases remain
in the `index.html` composition root.

## Out of scope (later phases)
- `gameState` re-namespace / analysis-pure extraction (Phase 2)
- React, engine rule changes, brotli/ops, admin soft-delete extras
- Cross-device server progress API

## Manual checklist (should still work)
- [ ] Home Scheme A: 模拟盘 / 知识馆 / 悔棋局 lanes; sim hub back
- [ ] Start game: fill-mode modal → progress → enter sim (local + cloud)
- [ ] Cloud resume: ACTIVE_GAME continue / restart / cancel
- [ ] Leaderboard deep link `#/leaderboard` + back to sim hub
- [ ] Academy + hindsight open/back; `#/academy` / `#/hindsight` / aliases
- [ ] Settings / auth chip; settlement share; mobile sticky trade bar
