# icon-unify P3 — drawn art over decorative emoji

* `js/emoji-art.js` + `css/emoji-art.css`: `emojiArtHtml(key)` keeps the emoji in the DOM as an invisible spacer and overlays an absolutely-centred PNG. The line box, advance and baseline are the emoji's own, so nothing moves. If an image fails, the slot gets `.ea-fallback` and the emoji shows again in the same box.
* Sites: auth 🎲 ×4 (day art only: kraft button in both themes), 📱 APK entry, 📷/📋 hindsight buttons (day only: kraft ctl-secondary), hindsight commodities 🧋☕📱✈️🏖️🏠📚 and the empty-state 🌱 at 14px.
* Dark art (`.ea-slot--themed`) is used only where the surface is dark in the dark theme (APK card, hindsight card).
* PNG only, no `<picture>`, so html2canvas can capture it. It skips `display:none`, so it captures the theme-matching art.
* Gifts: `GIFT_ART` gains flower/tomato/pipe/coffee (`assets/pvp/gift-*`). These four keep the emoji glyph box (`keepGlyphBox`: invisible spacer + overlaid art) and use the `-dark` art in the dark theme (swapped on theme toggle). fish/leaf are unchanged.
