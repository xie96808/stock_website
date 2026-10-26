/** DOM side of 头像框: wrap / unwrap an existing `<img>` so a frame shows around it. */
import { isFrameId, frameSvg } from "./avatar-frame-pure.js";

export { wrapAvatarHtml, isFrameId, FRAME_NAMES } from "./avatar-frame-pure.js";

/**
 * Put `frameId` around `img` (or take the frame away when it is empty / unknown).
 * Idempotent: calling it again with the same id does nothing; with another id it swaps the art.
 */
export function applyFrameToImg(img, frameId) {
  if (!img) return;
  if (!img.parentElement) {
    // Built-then-appended (PvP lists): retry once the caller has attached it.
    if (isFrameId(frameId)) queueMicrotask(() => { if (img.parentElement) applyFrameToImg(img, frameId); });
    return;
  }
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
