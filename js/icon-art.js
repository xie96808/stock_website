/**
 * Drawn 韭币 / 后悔券 art (assets/icon-unify/). Pure helpers + a one-time global fallback guard.
 *
 * Layout contract (do not break): the coin lives in the SAME box as the old inline SVG —
 * `.jiu-coin-icon { width:.95em; height:.95em }` (css/jiu-coin.css). The <img> only fills that box
 * (width/height attrs = intrinsic art px), so swapping art can never move a neighbour.
 * Light vs dark art is a CSS context choice (css/jiu-coin.css §icon-unify), never a per-call-site guess.
 * If the art fails to load, the old SVG is restored in place (same box) — see installIconArtFallback().
 * assets/ is not fingerprinted in release builds, so ART_V busts caches.
 */
export const ICON_ART_V = "20261019i";
const BASE = "assets/icon-unify/";

export const COIN_VARIANTS = Object.freeze([12, 14, 16, 20, 24]);

/** Nearest drawn size for an effective CSS-px box (0.95em × context font-size). 12→≤12.6, 14→≤14.8, 16→≤18, 20→≤22, else 24. */
export function coinVariantFor(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return 14;
  if (n <= 12.6) return 12;
  if (n <= 14.8) return 14;
  if (n <= 18) return 16;
  if (n <= 22) return 20;
  return 24;
}

function pictureHtml(name, px, cls, extra = "", picCls = "") {
  const b = `${BASE}${name}`;
  const v = `?v=${ICON_ART_V}`;
  return `<picture${picCls ? ` class="${picCls}"` : ""}><source type="image/webp" srcset="${b}.webp${v} 1x, ${b}@2x.webp${v} 2x">`
    + `<img class="${cls}" src="${b}.png${v}" srcset="${b}.png${v} 1x, ${b}@2x.png${v} 2x" width="${px}" height="${px}" alt="" decoding="async" draggable="false"${extra}></picture>`;
}

/** The original 24-unit inline glyph (kept verbatim as the no-art fallback; tinted by currentColor). */
export function coinSvgHtml({ size = 18 } = {}) {
  const s = Number(size) || 18;
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".18"/>
  <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M12 7.2v9.6M9.2 9.4c.7-1 2-1.5 2.8-1.5 1.6 0 2.7 1 2.7 2.3 0 1.5-1.3 2.2-2.7 2.6-1.5.4-2.7 1-2.7 2.5 0 1.4 1.2 2.4 3 2.4 1 0 2-.4 2.7-1.2"
    fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/**
 * Coin markup. `size` = nominal art size (snapped to a drawn variant; callers pass the effective px of their context).
 * Root keeps class `jiu-coin-icon` (the layout box). Both light and dark art are present; CSS shows exactly one.
 */
export function coinIconHtml({ size = 18, className = "jiu-coin-icon" } = {}) {
  const v = COIN_VARIANTS.includes(Number(size)) ? Number(size) : coinVariantFor(size);
  return `<span class="${className}" data-coin-art="${v}" aria-hidden="true">`
    + pictureHtml(`coin-glyph-${v}`, v, "jiu-coin-img jiu-coin-img--day", "", "jiu-coin-pic jiu-coin-pic--day")
    + pictureHtml(`coin-glyph-${v}-dark`, v, "jiu-coin-img jiu-coin-img--night", ' loading="lazy"', "jiu-coin-pic jiu-coin-pic--night")
    + `</span>`;
}

/** 后悔券 stub for the #rewindBtn glyph slot (15×17 art, light only: the button is a kraft surface in both themes). */
export function rewindTicketHtml() {
  const b = `${BASE}ticket-rewind-15x17`;
  const v = `?v=${ICON_ART_V}`;
  return `<picture><source type="image/webp" srcset="${b}.webp${v} 1x, ${b}@2x.webp${v} 2x">`
    + `<img class="rewind-ticket-img" src="${b}.png${v}" srcset="${b}.png${v} 1x, ${b}@2x.png${v} 2x" width="15" height="17" alt="" decoding="async" draggable="false"></picture>`;
}

/**
 * 后悔券 as an inline unit icon (「<ticket>×2」). A 1.15em square box (the stub art has more air than the coin), so it sits on
 * the text line like `.jiu-coin-icon`. Art: ticket-rewind-12 (box ≤13.5px) / ticket-rewind-15x17 (larger), both with a dark
 * twin that CSS shows only over genuinely dark surfaces (css/jiu-coin.css §icon-unify).
 */
export function ticketVariantFor(px) {
  const n = Number(px) * 1.15; // the box is 1.15em (css/jiu-coin.css)
  return Number.isFinite(n) && n > 13.5 ? "15x17" : "12";
}
export function ticketIconHtml({ size = 14, className = "ticket-icon" } = {}) {
  const v = ticketVariantFor(size);
  const [w, h] = v === "12" ? [12, 12] : [15, 17];
  const pic = (name, cls, extra, picCls) => {
    const b = `${BASE}${name}`;
    const q = `?v=${ICON_ART_V}`;
    return `<picture class="${picCls}"><source type="image/webp" srcset="${b}.webp${q} 1x, ${b}@2x.webp${q} 2x">`
      + `<img class="${cls}" src="${b}.png${q}" srcset="${b}.png${q} 1x, ${b}@2x.png${q} 2x" width="${w}" height="${h}" alt="" decoding="async" draggable="false"${extra}></picture>`;
  };
  return `<span class="${className}" data-ticket-art="${v}" aria-hidden="true">`
    + pic(`ticket-rewind-${v}`, "ticket-img ticket-img--day", "", "ticket-pic ticket-pic--day")
    + pic(`ticket-rewind-${v}-dark`, "ticket-img ticket-img--night", ' loading="lazy"', "ticket-pic ticket-pic--night")
    + `</span>`;
}

function restoreTicketText(img) {
  const root = img.closest(".ticket-icon");
  if (!root || root.classList.contains("is-art-fallback")) return;
  root.classList.add("is-art-fallback");
  root.textContent = "券";
}

function restoreCoinSvg(img) {
  const root = img.closest(".jiu-coin-icon");
  if (!root || root.classList.contains("is-art-fallback")) return;
  root.classList.add("is-art-fallback");
  root.innerHTML = coinSvgHtml({ size: Number(root.dataset.coinArt) || 14 });
  const svg = root.firstElementChild;
  if (svg) svg.removeAttribute("width"), svg.removeAttribute("height");
}

function restoreRewindGlyph(img) {
  const slot = img.closest(".rewind-btn-icon");
  if (!slot || slot.dataset.artFallback === "1") return;
  slot.dataset.artFallback = "1";
  slot.textContent = "\u21A9";
}

function handleArtFailure(img) {
  if (!(img instanceof HTMLImageElement)) return;
  // The lazy dark twin may be skipped/blocked while the day art is fine: only react to the VISIBLE image.
  if (img.classList.contains("jiu-coin-img")) {
    if (img.classList.contains("jiu-coin-img--night") && img.offsetParent === null) return;
    restoreCoinSvg(img);
  } else if (img.classList.contains("rewind-ticket-img")) {
    restoreRewindGlyph(img);
  } else if (img.classList.contains("ticket-img")) {
    if (img.classList.contains("ticket-img--night") && img.offsetParent === null) return;
    restoreTicketText(img);
  }
}

let installed = false;
/** One capture-phase `error` listener for every art <img> (also those rendered later via innerHTML) + a sweep for early failures. */
export function installIconArtFallback(root = typeof document !== "undefined" ? document : null) {
  if (!root || installed) return;
  installed = true;
  root.addEventListener("error", (e) => handleArtFailure(e.target), true);
  root.querySelectorAll("img.jiu-coin-img, img.rewind-ticket-img, img.ticket-img").forEach((img) => {
    if (img.complete && img.naturalWidth === 0) handleArtFailure(img);
  });
}

const preloaded = new Set();
/** Warm the small set of art the chrome/modals use so first paint is not an empty box (fire-and-forget). */
export function preloadIconArt() {
  if (typeof Image === "undefined") return;
  const dpr = typeof window !== "undefined" && window.devicePixelRatio > 1 ? "@2x" : "";
  for (const n of ["coin-glyph-12", "coin-glyph-12-dark", "coin-glyph-14", "coin-glyph-14-dark", "coin-glyph-16", "ticket-rewind-15x17", "ticket-rewind-12"]) {
    if (preloaded.has(n)) continue;
    preloaded.add(n);
    const im = new Image();
    im.decoding = "async";
    im.src = `${BASE}${n}${dpr}.png?v=${ICON_ART_V}`;
  }
}
