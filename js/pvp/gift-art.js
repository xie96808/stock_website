/**
 * Hand-drawn gift art (绘图bot). Kinds without art keep their emoji.
 * assets/ stays unhashed in release builds, so the ?v= token busts caches.
 */
const ART_V = "20261013g";
export const GIFT_ART = Object.freeze({
  fish: { name: "臭鱼", emoji: "🐟" },
  leaf: { name: "菜叶", emoji: "🥬" },
});

export function hasGiftArt(kind) {
  return Object.prototype.hasOwnProperty.call(GIFT_ART, kind);
}

/** <picture> with webp + png @1x/@2x; falls back to the emoji text if the image fails. */
export function giftArtNode(kind, { size = 48, className = "pvp-gift-img" } = {}) {
  const art = GIFT_ART[kind];
  if (!art) return null;
  const base = `assets/pvp/gift-${kind}`;
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
  glyph.textContent = "";
  glyph.append(node);
  button.dataset.artHydrated = "1";
}
