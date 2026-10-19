# 幸运转盘 — client (Batch 2)

Server contract + flag: see `docs/jiu-coin.md` (Batch 0). This PR is client-only and is inert while the server flag
`LUCKY_WHEEL_ENABLED` is OFF (no `wheel` field in `GET /me/jiu-coin` → the legacy 每日领取 flow is untouched).

## Files
| file | role |
|---|---|
| `js/lucky-wheel.js` | modal, spin timeline (rAF), pop-up, jackpot canvas FX. Lazy-loaded by `jiu-coin.js` via `importWithRetry`. |
| `js/lucky-wheel-pure.js` | DOM-free math/copy (landing angle, timeline, prize copy, error plan, idempotency key). Unit-tested. |
| `css/lucky-wheel.css` | entry-button skin, modal, wheel, pop-up. Asset urls carry `?v=` (= `LW_ASSET_V`). |
| `assets/lucky-wheel/` | drawing-bot kit (WebP + @2x, `MANIFEST.md`). |
| `js/jiu-coin.js` | the existing `#jiuCoinDailyBtn` becomes the wheel entry when `data.wheel.enabled`; legacy otherwise; `410 DAILY_REPLACED_BY_WHEEL` handled. |

## Behaviour
* Sectors, labels, odds, free spins all come from `GET /me/lucky-wheel`; colours are by position (`--lw-s0..7`, conic fills under the line-art face). Labels are DOM text (楷体 stack, ink `#26211d`), rotating with the disc, icon at the rim + large number inward.
* Spin: one `POST /me/lucky-wheel/spin` per attempt with an `Idempotency-Key` (kept across network errors so a retry replays). Animation: wind-up → accelerate → cruise (≥1.3 s) → decelerate → 3° overshoot settle ≈ 4.0 s; lands on `θ = 360n − (45k + j)` for the server `sector`/`landJitterDeg`. No client randomness.
* Pop-up kinds: coin, jackpot (888, `isJackpot` only), ticket (item), spin-again (primary = spin again), substituted coins (note explains why), replay note.
* Jackpot: rim-light blink + shake + canvas coin/confetti burst, rays + banner on the pop-up. `prefers-reduced-motion`: ≈0.4 s ease to the sector, static glow/rays/rim-light, no canvas/shake.
* Closing is blocked while a spin is unresolved; logout/flag-off cancels cleanly.
* Short/landscape viewports: two-column layout (≤560px high) + scale-to-fit fallback.

## QA helpers
`/workspace/lucky-wheel/b2/` (not in repo): `qa-server.mjs` (throwaway DB, forced-roll control port), `qa1..4.py` Playwright suites.
