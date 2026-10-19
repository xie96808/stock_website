/**
 * Drawn replacements for decorative emoji (assets/icon-unify/, P3).
 *
 * Layout contract: the emoji stays in the DOM as an invisible spacer
 * (`.ea-spacer { visibility:hidden }`), so the line box, the advance width and
 * the baseline are exactly what they were before. The art is an absolutely
 * positioned <img> centred over that spacer and cannot move a neighbour.
 * If the art fails to load, the slot gets `.ea-fallback`: the img is hidden
 * and the emoji shows again in the same box.
 *
 * PNG only (no <picture>/webp): html2canvas (hindsight share card) needs a
 * plain same-origin <img>. Light/dark art is a CSS choice (`.ea-slot--themed`
 * under [data-theme="dark"]), so html2canvas, which skips display:none,
 * captures whichever art matches the card.
 * assets/ is not fingerprinted in release builds, so EMOJI_ART_V busts caches.
 */
export const EMOJI_ART_V = "20261019p3";
const BASE = "assets/icon-unify/";

/** key → drawn file, overlay px, has a -dark variant, original emoji. */
export const EMOJI_ART = Object.freeze({
  dice: { file: "dice-20", px: 20, dark: false, emoji: "🎲" },
  "apk-phone": { file: "apk-phone-28", px: 28, dark: true, emoji: "📱" },
  camera: { file: "icon-camera-16", px: 16, dark: false, emoji: "📷" },
  clipboard: { file: "icon-clipboard-16", px: 16, dark: false, emoji: "📋" },
  "cm-milktea": { file: "cm-milktea", px: 24, dark: true, emoji: "🧋" },
  "cm-coffee": { file: "cm-coffee", px: 24, dark: true, emoji: "☕" },
  "cm-phone": { file: "cm-phone", px: 24, dark: true, emoji: "📱" },
  "cm-plane": { file: "cm-plane", px: 24, dark: true, emoji: "✈️" },
  "cm-beach": { file: "cm-beach", px: 24, dark: true, emoji: "🏖️" },
  "cm-house": { file: "cm-house", px: 24, dark: true, emoji: "🏠" },
  "cm-book": { file: "cm-book", px: 24, dark: true, emoji: "📚" },
  "cm-sprout": { file: "cm-sprout", px: 24, dark: true, emoji: "🌱" },
});

/** Hindsight commodity emoji (hindsight-pure.js DEFAULT_COMMODITIES + empty state) → art key. */
export const COMMODITY_ART_KEY = Object.freeze({
  "🧋": "cm-milktea", "☕": "cm-coffee", "📱": "cm-phone", "✈️": "cm-plane",
  "🏖️": "cm-beach", "🏠": "cm-house", "📚": "cm-book", "🌱": "cm-sprout",
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function imgHtml(file, px, cls, lazy) {
  const b = `${BASE}${file}`;
  const v = `?v=${EMOJI_ART_V}`;
  return `<img class="ea-img ${cls}" src="${b}.png${v}" srcset="${b}.png${v} 1x, ${b}@2x.png${v} 2x" width="${px}" height="${px}" alt="" decoding="async" draggable="false"${lazy ? ' loading="lazy"' : ""}>`;
}

/**
 * Slot markup for a drawn emoji. `size` overrides the overlay px (e.g. 14 for inline text use).
 * Unknown key → the plain emoji text (or "" if none given), so callers never lose content.
 */
export function emojiArtHtml(key, { size, emoji } = {}) {
  const art = EMOJI_ART[key];
  if (!art) return esc(emoji ?? "");
  const px = Number(size) > 0 ? Number(size) : art.px;
  const glyph = esc(emoji ?? art.emoji);
  const style = px === art.px ? "" : ` style="--ea-px:${px}px"`;
  return `<span class="ea-slot${art.dark ? " ea-slot--themed" : ""} ea-${key}" data-ea="${key}"${style}>`
    + `<span class="ea-spacer">${glyph}</span>`
    + imgHtml(art.file, px, "ea-img--day", false)
    + (art.dark ? imgHtml(`${art.file}-dark`, px, "ea-img--night", true) : "")
    + `</span>`;
}

/** Commodity icon by its emoji (falls back to the emoji text for anything unmapped). */
export function commodityArtHtml(emoji, opts = {}) {
  const key = COMMODITY_ART_KEY[emoji];
  return key ? emojiArtHtml(key, { ...opts, emoji }) : esc(emoji);
}

function markFallback(img) {
  const slot = img?.closest?.(".ea-slot");
  if (slot) slot.classList.add("ea-fallback");
}

let installed = false;
/** One capture-phase listener for every .ea-img on the page (static HTML and later renders) + a sweep for early failures. */
export function installEmojiArtFallback(doc = globalThis.document) {
  if (installed || !doc) return;
  installed = true;
  doc.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.classList?.contains("ea-img")) markFallback(t);
  }, true);
  const sweep = () => {
    for (const img of doc.querySelectorAll(".ea-img")) {
      if (img.complete && img.getAttribute("loading") !== "lazy" && img.naturalWidth === 0 && img.currentSrc) markFallback(img);
    }
  };
  sweep();
  if (doc.readyState !== "complete") globalThis.addEventListener?.("load", sweep, { once: true });
}
if (typeof document !== "undefined") installEmojiArtFallback();
