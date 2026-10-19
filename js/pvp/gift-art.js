/**
 * Hand-drawn gift art (绘图bot). Kinds without art keep their emoji.
 * assets/ stays unhashed in release builds, so the ?v= token busts caches.
 */
const ART_V = "20261013g";
export const GIFT_ART = Object.freeze({
  // dark: has a -dark variant (light-brown outline) used while the page is in the dark theme, where the picker
  // buttons, the page under the throw and the notice stage are dark. fish/leaf have no dark art (unchanged).
  // keepGlyphBox: the picker keeps the emoji as an invisible spacer and overlays the art, so these four
  // buttons keep exactly the box they had with the emoji (P3 layout contract). fish/leaf keep their shipped layout.
  flower: { name: "花花", emoji: "🌸", keepGlyphBox: true, dark: true },
  tomato: { name: "番茄", emoji: "🍅", keepGlyphBox: true, dark: true },
  pipe: { name: "烟斗", emoji: "💨", keepGlyphBox: true, dark: true },
  coffee: { name: "咖啡", emoji: "☕", keepGlyphBox: true, dark: true },
  fish: { name: "臭鱼", emoji: "🐟" },
  leaf: { name: "菜叶", emoji: "🥬" },
});

export function hasGiftArt(kind) {
  return Object.prototype.hasOwnProperty.call(GIFT_ART, kind);
}

function isDarkTheme() {
  return typeof document !== "undefined" && document.documentElement?.getAttribute("data-theme") === "dark";
}

function setGiftSources(picture, kind, dark) {
  const base = `assets/pvp/gift-${kind}${dark ? "-dark" : ""}`;
  const webp = picture.querySelector("source");
  const img = picture.querySelector("img");
  if (webp) webp.srcset = `${base}.webp?v=${ART_V} 1x, ${base}@2x.webp?v=${ART_V} 2x`;
  if (img) {
    img.src = `${base}.png?v=${ART_V}`;
    img.srcset = `${base}.png?v=${ART_V} 1x, ${base}@2x.png?v=${ART_V} 2x`;
  }
}

let themeWatched = false;
/** Swap day/dark gift art when the theme toggles (one observer for the page). */
function watchTheme() {
  if (themeWatched || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  themeWatched = true;
  new MutationObserver(() => {
    const dark = isDarkTheme();
    for (const img of document.querySelectorAll("img[data-gift-art]")) {
      const pic = img.parentElement;
      if (pic && pic.tagName === "PICTURE") setGiftSources(pic, img.dataset.giftArt, dark);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/** <picture> with webp + png @1x/@2x; falls back to the emoji text if the image fails. */
export function giftArtNode(kind, { size = 48, className = "pvp-gift-img" } = {}) {
  const art = GIFT_ART[kind];
  if (!art) return null;
  const dark = !!art.dark && isDarkTheme();
  const base = `assets/pvp/gift-${kind}${dark ? "-dark" : ""}`;
  const picture = document.createElement("picture");
  picture.className = `${className}-wrap`;
  const webp = document.createElement("source");
  webp.type = "image/webp";
  webp.srcset = `${base}.webp?v=${ART_V} 1x, ${base}@2x.webp?v=${ART_V} 2x`;
  const img = document.createElement("img");
  img.className = className;
  img.src = `${base}.png?v=${ART_V}`;
  img.srcset = `${base}.png?v=${ART_V} 1x, ${base}@2x.png?v=${ART_V} 2x`;
  img.alt = art.name;
  img.width = size;
  img.height = size;
  img.decoding = "async";
  img.draggable = false;
  if (art.dark) {
    img.dataset.giftArt = kind;
    watchTheme();
  }
  img.addEventListener("error", () => {
    const span = document.createElement("span");
    span.className = `${className}-fallback`;
    span.textContent = art.emoji;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", art.name);
    picture.replaceWith(span);
  }, { once: true });
  picture.append(webp, img);
  return picture;
}

/** Swap the emoji glyph inside a picker button for the drawn art (idempotent). */
export function hydrateGiftButton(button) {
  const kind = button?.dataset?.kind;
  if (!hasGiftArt(kind) || button.dataset.artHydrated === "1") return;
  const glyph = button.querySelector(".pvp-gift-glyph");
  const node = giftArtNode(kind, { size: 34 });
  if (!glyph || !node) return;
  if (GIFT_ART[kind].keepGlyphBox) {
    const spacer = document.createElement("span");
    spacer.className = "pvp-gift-spacer";
    spacer.textContent = glyph.textContent || GIFT_ART[kind].emoji;
    glyph.textContent = "";
    glyph.classList.add("pvp-gift-glyph--overlay");
    glyph.append(spacer, node);
  } else {
    glyph.textContent = "";
    glyph.append(node);
  }
  button.dataset.artHydrated = "1";
}
