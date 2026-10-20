/**
 * Battle invite: one invite link (POST /pvp/shares — the server reuses the
 * caller's open code until it expires), copied or rendered into a share image.
 *
 *   复制链接  → navigator.clipboard (ClipboardItem promise keeps Safari's user
 *              gesture alive while the link is fetched) → execCommand("copy").
 *              The Android shell (StockGameApp) has no clipboard method today;
 *              if one is added as copyText(text), it is used first.
 *   保存邀请图 → off-screen card → html2canvas → deliverImage(): Android
 *              StockGameApp.saveImage → Web Share files → <a download>.
 *
 * Share-image art is not final. INVITE_CARD_ART is the only place to plug it
 * in: set `background` to the finished art (same 1080×1440 canvas) and move
 * the QR / text slots to where the art leaves room. With background null the
 * placeholder layout below is drawn.
 */
import { showToast } from "../auth.js";
import { buildBattleSharePayload, PVP_INVITE_SHARE_TEXT } from "./copy.js";
import { pvpFetch } from "./transport.js";

export const INVITE_CARD_ART = Object.freeze({
  width: 1080,
  height: 1440,
  /** Full-bleed background art URL (same-origin, 1080×1440 PNG/WebP), or null for the placeholder. */
  background: null,
  /** QR slot on the card, in card pixels. */
  qr: { left: 360, top: 900, size: 360 },
  /** Text block under the QR (invite line + link). */
  text: { left: 96, top: 1290, width: 888 },
});

const INK = "#2c2824";
const SOFT = "#6b6258";
const KRAFT = "#f3ead8";
const FONT_KAI = '"Kaiti SC","STKaiti","KaiTi","BiauKai","Noto Serif CJK SC","Songti SC",serif';
const FONT_MONO = 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace';
const COVER = "assets/pvp/battle-cover.webp";

let cached = null; // { payload, code, expiresAt }

function fresh(entry, now = Date.now()) {
  if (!entry) return false;
  const exp = Number(entry.expiresAt);
  return !Number.isFinite(exp) || exp - now > 60_000;
}

/** Resolves { title, text, url, clipboard, code }. Throws on server/link errors. */
export async function getInvitePayload() {
  if (fresh(cached)) return cached.payload;
  const { data } = await pvpFetch("/pvp/shares", { method: "POST", body: {} });
  const payload = buildBattleSharePayload(data?.code, location.origin);
  if (!payload.url) throw new Error("没能生成分享链接");
  cached = { payload: { ...payload, code: data.code }, code: data.code, expiresAt: data.expiresAt };
  return cached.payload;
}

export function forgetInvitePayload() {
  cached = null;
}

function execCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}

function bridgeCopy(text) {
  try {
    const app = window.StockGameApp;
    if (app && typeof app.copyText === "function") {
      const res = app.copyText(text);
      return res === undefined || res === true || res === "true" || res === "copied";
    }
  } catch { /* ignore */ }
  return false;
}

/** Copy text that may still be loading. Returns { ok, text }. */
export async function copyInvite(textPromise) {
  const promise = Promise.resolve(textPromise);
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : null;
  // Safari drops the user gesture across an await; a promised ClipboardItem keeps it.
  if (clip?.write && typeof window.ClipboardItem === "function" && !fresh(cached)) {
    try {
      const item = new window.ClipboardItem({
        "text/plain": promise.then((t) => new Blob([t], { type: "text/plain" })),
      });
      await clip.write([item]);
      return { ok: true, text: await promise };
    } catch { /* fall through */ }
  }
  let text = "";
  try { text = await promise; } catch (err) { return { ok: false, text: "", error: err }; }
  if (bridgeCopy(text)) return { ok: true, text };
  try {
    if (clip?.writeText) {
      await clip.writeText(text);
      return { ok: true, text };
    }
  } catch { /* fall through to execCommand */ }
  return { ok: execCopy(text), text };
}

/** 复制链接 button. */
export async function copyInviteLink({ note } = {}) {
  let payload = null;
  const textPromise = getInvitePayload().then((p) => { payload = p; return p.clipboard; });
  const res = await copyInvite(textPromise);
  if (res.error) {
    showToast(res.error.message || "没能生成分享链接", "error");
    return "error";
  }
  if (note && payload) note.textContent = payload.url;
  if (res.ok) {
    showToast("链接已复制", "success");
    return "copied";
  }
  showToast("没能复制，请长按下方链接", "error");
  return "failed";
}

function el(tag, style = {}, text) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text != null) node.textContent = String(text);
  return node;
}

function picture(src, style) {
  const node = document.createElement("img");
  node.alt = "";
  node.crossOrigin = "anonymous";
  node.src = src;
  Object.assign(node.style, { display: "block", ...style });
  return node;
}

/** Off-screen invite card. `art` defaults to INVITE_CARD_ART. */
export async function buildInviteCard(payload, { art = INVITE_CARD_ART } = {}) {
  const share = await import("../share-image.js");
  const qr = await share.qrDataUrl(payload.url);
  const root = el("div", {
    position: "fixed", left: "-20000px", top: "0",
    width: `${art.width}px`, height: `${art.height}px`, boxSizing: "border-box",
    background: KRAFT, color: INK, fontFamily: FONT_KAI, overflow: "hidden",
  });
  root.setAttribute("aria-hidden", "true");
  root.dataset.shareCard = "pvp-invite";

  if (art.background) {
    root.append(picture(art.background, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" }));
  } else {
    // Placeholder layout until the commissioned art lands.
    root.append(el("div", { position: "absolute", inset: "24px", border: `5px solid ${INK}`, borderRadius: "34px 40px 30px 38px" }));
    root.append(el("div", { position: "absolute", left: "96px", top: "92px", fontSize: "34px", letterSpacing: "0.3em", color: SOFT }, "双人对战 · 约战邀请"));
    root.append(el("div", { position: "absolute", left: "96px", top: "150px", fontSize: "76px", fontWeight: "700", letterSpacing: "0.1em" }, "来一局？"));
    root.append(picture(COVER, { position: "absolute", left: "96px", top: "286px", width: "888px", height: "444px", objectFit: "cover", borderRadius: "22px", border: `4px solid ${INK}` }));
    root.append(el("div", { position: "absolute", left: "96px", top: "772px", width: "888px", fontSize: "40px", lineHeight: "1.4", textAlign: "center" }, PVP_INVITE_SHARE_TEXT));
  }

  // White frame keeps a wide quiet zone between the ink border and the code.
  const qrFrame = el("div", {
    position: "absolute", left: `${art.qr.left}px`, top: `${art.qr.top}px`,
    width: `${art.qr.size}px`, height: `${art.qr.size}px`, boxSizing: "border-box",
    padding: "24px", background: "#fff", border: `5px solid ${INK}`, borderRadius: "18px",
  });
  qrFrame.append(picture(qr, { display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }));
  root.append(qrFrame);
  const words = el("div", {
    position: "absolute", left: `${art.text.left}px`, top: `${art.text.top}px`, width: `${art.text.width}px`,
    display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center",
  });
  words.append(el("div", { fontSize: "30px", color: SOFT }, "扫码进房间 · 早知道当初不炒了"));
  words.append(el("div", { fontFamily: FONT_MONO, fontSize: "26px", color: SOFT, wordBreak: "break-all" }, payload.url));
  root.append(words);

  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll("img")].map((node) => (
    node.complete && node.naturalWidth > 0
      ? Promise.resolve()
      : new Promise((resolve) => {
        node.onload = resolve;
        node.onerror = () => { node.style.visibility = "hidden"; resolve(); };
      })
  )));
  return root;
}

const DONE_COPY = {
  "bridge-saved": "已保存到相册",
  "bridge-shared": "已打开系统分享",
  shared: "已打开分享",
  downloaded: "邀请图已保存",
};

/** 保存邀请图 button. Never throws. */
export async function saveInviteImage({ note } = {}) {
  let node = null;
  try {
    const payload = await getInvitePayload();
    if (note) note.textContent = payload.url;
    const share = await import("../share-image.js");
    node = await buildInviteCard(payload);
    const canvas = await share.renderNodeToCanvas(node);
    node.remove();
    node = null;
    const how = await share.deliverImage(canvas, `zaozhidao-pvp-invite-${payload.code}.png`, { text: PVP_INVITE_SHARE_TEXT });
    if (DONE_COPY[how]) showToast(DONE_COPY[how], "success");
    return how;
  } catch (err) {
    console.warn("invite image failed", err);
    showToast(err?.message && err.status ? err.message : "邀请图没生成出来，请稍后再试", "error");
    return "error";
  } finally {
    if (node) node.remove();
  }
}
