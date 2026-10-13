/**
 * Avatar image fallback: when a custom avatar (/api/v1/avatars/…) or preset
 * avatar fails to load, swap to the img's data-fallback-src (if given) or the
 * default preset. One capture-phase listener covers every <img> on the page.
 * Never loops: an image already showing the fallback is left alone.
 */
export const DEFAULT_AVATAR_SRC = "/images/avatars/01.png";
const AVATAR_SRC_RE = /(\/api\/v1\/avatars\/|images\/avatars\/)/;

export function avatarFallbackFor(img) {
  return img.getAttribute("data-fallback-src") || DEFAULT_AVATAR_SRC;
}

export function handleAvatarError(img) {
  if (!img || img.tagName !== "IMG") return false;
  const src = img.getAttribute("src") || "";
  if (!AVATAR_SRC_RE.test(src) || src === DEFAULT_AVATAR_SRC) return false;
  const preset = img.getAttribute("data-fallback-src");
  const next = preset && src !== preset && !img.hasAttribute("data-avatar-fallback") ? preset : DEFAULT_AVATAR_SRC;
  img.setAttribute("data-avatar-fallback", src);
  img.setAttribute("src", next);
  return true;
}

export function installAvatarFallback(doc = typeof document !== "undefined" ? document : null) {
  if (!doc || doc.__avatarFallbackInstalled) return;
  doc.__avatarFallbackInstalled = true;
  doc.addEventListener("error", (e) => { handleAvatarError(e.target); }, true);
}
