/** DOM side of 头像框: wrap / unwrap an existing `<img>` so a frame shows around it. */
import { isFrameId, frameSvg, isMedalId, medalPlaqueHtml } from "./avatar-frame-pure.js";

export { wrapAvatarHtml, isFrameId, isMedalId, FRAME_NAMES } from "./avatar-frame-pure.js";

/**
 * Put `frameId` around `img` (or take the frame away when it is empty / unknown).
 * Idempotent: calling it again with the same id does nothing; with another id it swaps the art.
 */
export function applyFrameToImg(img, frameId, medal) {
  if (!img) return;
  if (!img.parentElement) {
    // Built-then-appended (PvP lists): retry once the caller has attached it.
    if (isFrameId(frameId) || isMedalId(medal)) queueMicrotask(() => { if (img.parentElement) applyFrameToImg(img, frameId, medal); });
    return;
  }
  applyFrameCore(img, frameId);
  applyMedalTo(img, medal);
}

/**
 * Put / swap / remove the 韭币榜 plaque around `img` (outside any frame wrapper). Idempotent.
 */
function applyMedalTo(img, medal) {
  const inner = img.parentElement && img.parentElement.classList.contains("avf") && img.parentElement.dataset.avf === "1" ? img.parentElement : img;
  const outer = inner.parentElement;
  if (!outer) return;
  const wrapped = outer.classList.contains("avm") && outer.dataset.avm === "1";
  if (!isMedalId(medal)) {
    if (wrapped) outer.replaceWith(inner);
    return;
  }
  if (wrapped) {
    if (outer.dataset.medal === medal) return;
    outer.dataset.medal = medal;
    outer.className = `avm avm--${medal}`;
    const plaque = outer.querySelector(".avm-plaque");
    if (plaque) plaque.outerHTML = medalPlaqueHtml(medal);
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = `avm avm--${medal}`;
  wrap.dataset.avm = "1";
  wrap.dataset.medal = medal;
  inner.replaceWith(wrap);
  wrap.appendChild(inner);
  wrap.insertAdjacentHTML("beforeend", medalPlaqueHtml(medal));
}

function applyFrameCore(img, frameId) {
  const parent = img.parentElement;
  const wrapped = parent.classList.contains("avf") && parent.dataset.avf === "1";
  const id = isFrameId(frameId) ? frameId : null;
  if (!id) {
    if (wrapped) {
      parent.replaceWith(img);
    }
    return;
  }
  if (wrapped) {
    if (parent.dataset.frame === id) return;
    parent.dataset.frame = id;
    parent.className = `avf avf--${id}`;
    const art = parent.querySelector(".avf-art");
    if (art) art.outerHTML = frameSvg(id);
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = `avf avf--${id}`;
  wrap.dataset.avf = "1";
  wrap.dataset.frame = id;
  img.replaceWith(wrap);
  wrap.appendChild(img);
  wrap.insertAdjacentHTML("beforeend", frameSvg(id));
}
