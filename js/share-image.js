/**
 * 保存分享图 — local html2canvas (js/vendor) → PNG.
 * Delivery order: Android bridge StockGameApp.saveImage(base64, fileName)
 *   → navigator.share({ files }) → <a download>. Failure → stamp toast.
 * PvP card: ~1080×1440, period, result, both avatars/nicks/returns,
 * rating change + rank, return curves (static canvas image), stock/date,
 * invite link + QR, slogan.
 */
import { importWithRetry } from "./lazy-import.js";
import { displayAvatarUrl, getAuthState } from "./auth.js";
import { handleAvatarError } from "./avatar-fallback.js";
import { showStampToast } from "./controls.js";
import { formatCoin, formatPpm, formatWindow, resultHeadline } from "./pvp/copy.js";
import { rankIconPathForTitle } from "../shared/pvpRating.js";

const CARD_W = 1080;
const CARD_H = 1440;
const SITE_ORIGIN = "https://stockgame.xieyw.top";
const SLOGAN = "早知道当初不炒了";
const SUB_SLOGAN = "同一段行情，两个人各做各的决定";
const INK = "#2c2824";
const KRAFT = "#f3ead8";
const UP = "#d64545";
const DOWN = "#2f9e5b";
const FONT_KAI = '"Kaiti SC","STKaiti","KaiTi","BiauKai","Noto Serif CJK SC","Songti SC",serif';
const FONT_MONO = 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace';

export function inviteUrl(origin = typeof location !== "undefined" ? location.origin : "") {
  const base = /^https?:\/\//.test(origin || "") ? origin : SITE_ORIGIN;
  return `${base.replace(/\/$/, "")}/#/pvp`;
}

function tone(ppm) {
  const v = Number(ppm);
  if (ppm == null || !Number.isFinite(v) || v === 0) return INK;
  return v > 0 ? UP : DOWN;
}

function el(tag, style = {}, text) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text != null) node.textContent = String(text);
  return node;
}

function img(src, size, style = {}) {
  const node = document.createElement("img");
  node.crossOrigin = "anonymous";
  node.alt = "";
  node.width = size;
  node.height = size;
  node.src = src;
  Object.assign(node.style, { width: `${size}px`, height: `${size}px`, display: "block", ...style });
  return node;
}

function curveValues(side) {
  const list = Array.isArray(side?.curve) ? side.curve : [];
  return list
    .map((p) => (typeof p === "number" ? p : Number(p?.returnPpm ?? p?.ppm ?? p?.value)))
    .filter((v) => Number.isFinite(v));
}

/** Static image of both return curves (me = cinnabar, opponent = ink). */
export function drawCurvesDataUrl(view, w = 960, h = 300) {
  const me = curveValues(view?.replay?.me);
  const opp = curveValues(view?.replay?.opponent);
  if (me.length < 2 && opp.length < 2) return "";
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const all = [...me, ...opp, 0];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = 18;
  const n = Math.max(me.length, opp.length) - 1 || 1;
  const x = (i) => pad + (i / n) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  ctx.strokeStyle = "rgba(44,40,36,0.35)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, y(0));
  ctx.lineTo(w - pad, y(0));
  ctx.stroke();
  ctx.setLineDash([]);
  const line = (vals, color, width) => {
    if (vals.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
  };
  line(opp, "rgba(58,53,48,0.75)", 5);
  line(me, "#c8452e", 7);
  return canvas.toDataURL("image/png");
}

export async function qrDataUrl(text) {
  const { default: qrcode } = await importWithRetry(
    "qrcode",
    () => import("./vendor/qrcode.js"),
    () => new URL("./vendor/qrcode.js", import.meta.url).href,
  );
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 2);
}

function finalPpm(side, replaySide) {
  const v = side?.returnPpm;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  const vals = curveValues(replaySide);
  return vals.length ? vals[vals.length - 1] : null;
}

function dateText(view, now = new Date()) {
  const raw = view?.settledAt || view?.endedAt || null;
  const d = raw ? new Date(raw) : now;
  const t = Number.isNaN(d.getTime()) ? now : d;
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

function seatBlock(face, label, ppm, outcome) {
  const box = el("div", {
    flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px",
    padding: "24px 16px 22px", border: `4px solid ${INK}`, borderRadius: "28px",
    background: outcome === "win" ? "#fbefd9" : "#fffaf0",
  });
  box.append(img(displayAvatarUrl(face || { avatarId: 1 }), 124, { borderRadius: "50%", border: `5px solid ${INK}`, objectFit: "cover", background: KRAFT }));
  box.append(el("div", { fontSize: "30px", letterSpacing: "0.2em", color: "#6b6258" }, label));
  box.append(el("div", { fontSize: "44px", fontWeight: "700", maxWidth: "420px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, face?.nickname || label));
  box.append(el("div", { fontFamily: FONT_MONO, fontSize: "60px", fontWeight: "700", color: tone(ppm) }, formatPpm(ppm)));
  if (outcome === "win") box.append(el("div", { fontSize: "30px", color: "#fff", background: "#c8452e", padding: "4px 18px", borderRadius: "8px", transform: "rotate(-4deg)" }, "胜"));
  return box;
}

/** Build the off-screen 1080×1440 share card. Resolves once images settle. */
export async function buildPvpShareCard(view) {
  const auth = getAuthState().user;
  const meFace = {
    nickname: view?.me?.nickname || auth?.nickname || "我",
    avatarId: view?.me?.avatarId || auth?.avatarId || 1,
    avatarUrl: view?.me?.avatarUrl || auth?.avatarUrl || null,
  };
  const root = el("div", {
    position: "fixed", left: "-20000px", top: "0", width: `${CARD_W}px`, height: `${CARD_H}px`,
    boxSizing: "border-box", padding: "64px 72px", background: KRAFT, color: INK,
    fontFamily: FONT_KAI, display: "flex", flexDirection: "column", gap: "26px", overflow: "hidden",
  });
  root.setAttribute("aria-hidden", "true");
  root.dataset.shareCard = "pvp";
  root.append(el("div", { position: "absolute", inset: "22px", border: `5px solid ${INK}`, borderRadius: "34px 40px 30px 38px", pointerEvents: "none" }));

  const head = el("div", { display: "flex", justifyContent: "space-between", alignItems: "baseline" });
  head.append(el("div", { fontSize: "34px", letterSpacing: "0.3em", color: "#6b6258" }, "双人对战 · 战报"));
  const id = view?.identity;
  const stock = id?.stockName ? `${id.stockName}${id.stockCode ? ` ${id.stockCode}` : ""}` : "";
  head.append(el("div", { fontSize: "32px", fontWeight: "700" }, stock));
  root.append(head);
  const period = formatWindow(id);
  root.append(el("div", { fontFamily: FONT_MONO, fontSize: "28px", color: "#6b6258", marginTop: "-12px" }, `${period ? `行情区间 ${period} · ` : ""}对局 ${dateText(view)}`));
  root.append(el("div", { fontSize: "64px", fontWeight: "700", letterSpacing: "0.08em", lineHeight: "1.15" }, resultHeadline(view) || "对战结果"));

  const seats = el("div", { display: "flex", gap: "36px", alignItems: "stretch" });
  seats.append(
    seatBlock(meFace, "我", finalPpm(view?.me, view?.replay?.me), view?.me?.outcome),
    seatBlock(view?.opponent || { avatarId: 1 }, "对手", finalPpm(view?.opponent, view?.replay?.opponent), view?.opponent?.outcome),
  );
  root.append(seats);

  const delta = view?.me?.ratingDelta;
  const titleText = view?.me?.ratingTitle || view?.me?.title || "";
  const rating = el("div", { display: "flex", alignItems: "center", gap: "24px", minHeight: "96px" });
  if (titleText) rating.append(img(rankIconPathForTitle(titleText), 112));
  const rText = el("div", { display: "flex", flexDirection: "column", gap: "6px" });
  if (titleText) rText.append(el("div", { fontSize: "40px", fontWeight: "700", letterSpacing: "0.12em" }, titleText));
  if (delta != null && Number.isFinite(Number(delta))) {
    const before = view?.me?.ratingBefore;
    const after = view?.me?.ratingAfter;
    const range = before != null && after != null ? `（${before} → ${after}）` : "";
    rText.append(el("div", { fontSize: "34px", color: tone(Number(delta) * 10000) }, `段位分 ${formatCoin(delta)}${range}`));
  }
  rating.append(rText);
  root.append(rating);

  const curves = drawCurvesDataUrl(view, 930, 232);
  if (curves) {
    const wrap = el("div", { border: `4px solid ${INK}`, borderRadius: "22px", background: "#fffaf0", padding: "14px 0 6px", display: "flex", flexDirection: "column", alignItems: "center" });
    const pic = document.createElement("img");
    pic.src = curves;
    pic.alt = "";
    Object.assign(pic.style, { width: "930px", height: "232px", display: "block" });
    wrap.append(pic);
    wrap.append(el("div", { fontSize: "26px", color: "#6b6258", letterSpacing: "0.1em" }, "收益曲线 · 红：我　灰：对手"));
    root.append(wrap);
  }

  const foot = el("div", { marginTop: "auto", display: "flex", alignItems: "center", gap: "34px" });
  const link = inviteUrl();
  let qr = "";
  try { qr = await qrDataUrl(link); } catch { qr = ""; }
  if (qr) {
    const q = document.createElement("img");
    q.src = qr;
    q.alt = "";
    Object.assign(q.style, { width: "176px", height: "176px", display: "block", background: "#fff", border: `4px solid ${INK}`, borderRadius: "14px", imageRendering: "pixelated" });
    foot.append(q);
  }
  const words = el("div", { display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" });
  words.append(el("div", { fontSize: "56px", fontWeight: "700", letterSpacing: "0.16em" }, SLOGAN));
  words.append(el("div", { fontSize: "30px", color: "#6b6258" }, `${SUB_SLOGAN}，扫码来约一局`));
  words.append(el("div", { fontFamily: FONT_MONO, fontSize: "26px", color: "#6b6258", wordBreak: "break-all" }, link));
  foot.append(words);
  root.append(foot);

  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll("img")].map((node) => (
    (node.complete && node.naturalWidth > 0) ? Promise.resolve() : new Promise((r) => {
      node.onload = r;
      node.onerror = () => {
        // Custom avatar 404 → default preset once; anything else just hides.
        if (handleAvatarError(node)) return;
        node.style.visibility = "hidden"; r();
      };
    })
  )));
  return root;
}

export async function renderNodeToCanvas(node) {
  const { default: html2canvas } = await importWithRetry(
    "html2canvas",
    () => import("./vendor/html2canvas.esm.js"),
    () => new URL("./vendor/html2canvas.esm.js", import.meta.url).href,
  );
  return html2canvas(node, {
    backgroundColor: KRAFT,
    scale: 1,
    useCORS: true,
    logging: false,
    width: node.offsetWidth,
    height: node.offsetHeight,
    windowWidth: node.offsetWidth,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    onclone: (doc) => {
      const clone = doc.querySelector('[data-share-card]');
      if (clone) { clone.style.left = "0px"; clone.style.top = "0px"; }
    },
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob empty"))), "image/png");
  });
}

/**
 * Hand a PNG off. Returns "bridge-saved" | "bridge-shared" | "shared" | "downloaded" | "cancelled".
 */
export async function deliverImage(canvas, fileName, { title = SLOGAN, text = "" } = {}, win = window) {
  const app = win?.StockGameApp;
  if (app && typeof app.saveImage === "function") {
    const base64 = canvas.toDataURL("image/png").split(",")[1] || "";
    let res = "";
    try { res = String(app.saveImage(base64, fileName) ?? ""); } catch { res = ""; }
    if (res === "saved" || res === "true") return "bridge-saved";
    if (res === "shared") return "bridge-shared";
  }
  const blob = await canvasToBlob(canvas);
  const nav = win?.navigator;
  if (nav && typeof nav.share === "function" && typeof File === "function") {
    const file = new File([blob], fileName, { type: "image/png" });
    const can = typeof nav.canShare === "function" ? nav.canShare({ files: [file] }) : false;
    if (can) {
      try {
        await nav.share({ files: [file], title, text });
        return "shared";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancelled";
        // fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

export function shareFileName(view, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const id = view?.matchId ? `-${String(view.matchId).slice(0, 8)}` : "";
  return `zaozhidao-pvp${id}-${stamp}.png`;
}

const DONE_COPY = {
  "bridge-saved": "已保存到相册",
  "bridge-shared": "已打开系统分享",
  shared: "已打开分享",
  downloaded: "分享图已保存",
};

/** Full flow used by the PvP result 保存分享图 button. Never throws. */
export async function savePvpShareImage(view) {
  let node = null;
  try {
    node = await buildPvpShareCard(view);
    const canvas = await renderNodeToCanvas(node);
    node.remove();
    node = null;
    const how = await deliverImage(canvas, shareFileName(view), { text: `${resultHeadline(view)} · ${SLOGAN}` });
    if (DONE_COPY[how]) showStampToast(DONE_COPY[how], "success");
    return how;
  } catch (err) {
    console.warn("share image failed", err);
    showStampToast("分享图没生成出来，请稍后再试", "error");
    return "error";
  } finally {
    if (node) node.remove();
  }
}
