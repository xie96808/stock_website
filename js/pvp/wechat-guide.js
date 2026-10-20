/**
 * 分享对战 inside the WeChat in-app browser.
 *
 * Pages cannot open WeChat's share sheet without a verified account + JS-SDK, so
 * instead of the copy fallback we point at the native ··· menu. While the guide
 * is up, the address bar shows the invite path (so 发送给朋友 forwards the invite,
 * not #pvp) and the title is the invite title; both are restored on dismiss.
 * iOS WeChat can long-press-save images, so it also gets the S6 invite card.
 */

const TITLE = "来【早知道当初不炒了】模拟盘对战";

export function isWeChatBrowser(ua = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  return /MicroMessenger\//i.test(String(ua || ""));
}

export function isIosUa(ua = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  return /iPhone|iPad|iPod/i.test(String(ua || ""));
}

/** Same-origin path of the invite link, or null when it is not ours. */
export function invitePath(url, origin = typeof location !== "undefined" ? location.origin : "") {
  try {
    const u = new URL(url, origin || undefined);
    if (origin && u.origin !== origin) return null;
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

const ARROW_SVG = `<svg class="pvp-wx-arrow" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <path d="M18 108 C30 74 56 50 98 22" />
  <path d="M74 20 C84 21 92 21 100 20 C99 29 97 37 95 46" />
</svg>`;

let open = null;

export function closeWeChatGuide() {
  if (!open) return;
  const { node, restoreUrl, restoreTitle, onKey } = open;
  open = null;
  node.remove();
  document.removeEventListener("keydown", onKey);
  try { history.replaceState(history.state, "", restoreUrl); } catch { /* ignore */ }
  document.title = restoreTitle;
}

/**
 * @param {{ url: string, code?: string }} payload invite payload
 * @param {{ ua?: string, imageUrl?: Promise<string|null>|string|null }} opts
 */
export function showWeChatGuide(payload, { ua, imageUrl = null } = {}) {
  closeWeChatGuide();
  const ios = isIosUa(ua);
  const node = document.createElement("div");
  node.className = "pvp-wx-guide";
  node.id = "pvpWeChatGuide";
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-modal", "true");
  node.setAttribute("aria-label", "点右上角 ··· 发送给朋友");
  node.innerHTML = `${ARROW_SVG}
    <div class="pvp-wx-card">
      <p class="pvp-wx-main">点右上角 <span class="pvp-wx-dots" aria-hidden="true">···</span> 发送给朋友</p>
      <p class="pvp-wx-sub">朋友点开就能进房间</p>
      ${ios ? `<figure class="pvp-wx-figure" hidden><img class="pvp-wx-img" alt="对战邀请图" /><figcaption>或长按图片保存，再发给朋友</figcaption></figure>` : ""}
      <p class="pvp-wx-dismiss">点任意处关闭</p>
    </div>`;
  const restoreUrl = `${location.pathname}${location.search}${location.hash}`;
  const restoreTitle = document.title;
  const onKey = (e) => { if (e.key === "Escape") closeWeChatGuide(); };
  node.addEventListener("click", (e) => {
    // Let iOS long-press the card image without closing the guide.
    if (e.target && e.target.closest && e.target.closest(".pvp-wx-img")) return;
    closeWeChatGuide();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(node);
  open = { node, restoreUrl, restoreTitle, onKey };
  const path = invitePath(payload?.url);
  if (path) {
    try { history.replaceState(history.state, "", path); } catch { /* ignore */ }
  }
  document.title = TITLE;
  if (ios && imageUrl) {
    Promise.resolve(imageUrl).then((src) => {
      if (!src || !open || open.node !== node) return;
      const fig = node.querySelector(".pvp-wx-figure");
      const img = node.querySelector(".pvp-wx-img");
      if (!fig || !img) return;
      img.src = src;
      fig.hidden = false;
    }).catch(() => {});
  }
  return node;
}
