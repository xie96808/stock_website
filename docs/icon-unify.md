# icon-unify (P1+P2): drawn 韭币 + 后悔券 art

Assets: `assets/icon-unify/` (see its MANIFEST.md). Code: `js/icon-art.js`, `css/jiu-coin.css` (§icon-unify), `css/game.css` (§icon-unify), `index.html` (`#rewindBtn`).

## Contract (do not break)
* **Box**: the coin lives in the unchanged `.jiu-coin-icon` box (`width/height: .95em`, `overflow:hidden`, `flex:none`). The art only fills it; `<img width/height>` carry the intrinsic size, so nothing can shift when it loads. The `size` argument of `coinIconHtml()` / `amountWithCoinHtml()` is now *meaningful*: it selects the drawn variant (12/14/16/20/24) and must be the context's effective px (0.95 × font-size). `coinVariantFor(px)` does the snapping.
* **Light/dark art**: light is the default everywhere. Dark art is opt-in, only over genuinely dark surfaces in the dark theme (list in `css/jiu-coin.css`: balance chip, price pills, academy zone cards, PvP rules list, PvP ready copy, PvP result score meta — each measured dark in the dark theme by the bg-probe screenshots). Kraft surfaces (modals, rewind button/confirm, rank card, fill-mode dialog) keep light art in the dark theme.
* **Fallback**: a capture-phase `error` listener (`installIconArtFallback`) restores the old inline SVG (same box, `currentColor` tint rules unchanged) or the `↩` glyph in `#rewindBtn`.
* **Cache**: `assets/` is not fingerprinted — bump `ICON_ART_V` (js/icon-art.js, and the static URLs in index.html) when art changes.
* Text-only "韭币" mentions, admin, server strings, ✓/○ protocol strings, charts are untouched.

## Rewind slot
`.rewind-btn-icon` = `.998em × 1.1em` (= 15.17×16.72 at the 15.2px button font, the old ↩ glyph box), flex-centred; label x and button width are identical to before.
