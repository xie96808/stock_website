/**
 * PvP invite share image, design S6 (Bill, PR #199): a trading-app K-line card.
 * Drawn straight onto a canvas at 1080×1440 × scale (2 → 2160×2880).
 *
 * Layers
 *   1. S6_ART.background: the art layer (card, chart panel, tab pill, avatar
 *      rings, VS badge). No text, no QR. Swap the art by changing these URLs;
 *      every box below is in 1080×1440 card pixels (S6-layout.json).
 *   2. Everything else is drawn here: text, chart, avatar, QR.
 *
 * Stock privacy: an invite has no match yet. The server picks the stock window
 * only when both players are ready (challenges.js startPlayingInTx →
 * pickRandomWindow) and reveals stock name / code / dates only after a
 * completed settlement (view.js revealAll → view.identity). So the card never
 * names a stock: it shows MASKED_STOCK_LABEL and draws S6_SAMPLE_BARS, the S6
 * art's own synthetic series (seed 26). It is not market data and cannot match
 * any real window. O/H/L/C and MA are computed from those bars.
 */
import { PVP_INVITE_SHARE_TEXT } from "./copy.js";
import { importWithRetry } from "../lazy-import.js";

const V = "20261020s6";
export const S6_ART = Object.freeze({
  width: 1080,
  height: 1440,
  background: { 1: `assets/pvp/share/s6-bg.png?v=${V}`, 2: `assets/pvp/share/s6-bg@2x.png?v=${V}` },
});

export const MASKED_STOCK_LABEL = "神秘个股 · 开局揭晓";
export const SAMPLE_CAPTION = "示意走势 · 真实行情开局随机分配";
export const S6_SUBLINE = "同一段行情，两个人各做各的决定，扫码来约一局";
export const S6_BRAND = "早知道当初不炒了";

const C = Object.freeze({
  paper: "#F3EAD8", ink: "#2C2824", grey: "#8A8074", grey2: "#686159",
  up: "#D64545", down: "#2F9E5B", panel: "#FFFAF0", ma5: "#D69628", ma10: "#466EB4", white: "#FFFFFF",
});

/** S6 synthetic sample, [open, high, low, close, volume]; oldest first. */
export const S6_SAMPLE_BARS = Object.freeze([
  [100, 101.86, 82.86, 84.2, 44.356],
  [84.2, 86.2, 82.83, 85.48, 5.452],
  [85.48, 85.63, 83.39, 84.44, 5.925],
  [84.44, 87.48, 82.29, 85.4, 4.12],
  [85.4, 85.45, 82.29, 83.93, 6.886],
  [83.93, 84.81, 83.05, 84.54, 2.228],
  [84.54, 95.44, 83.12, 94.05, 73.148],
  [94.05, 99.22, 92.52, 98.74, 20.152],
  [98.74, 101.12, 97.2, 98.63, 1.03],
  [98.63, 102.97, 98.3, 101.45, 6.658],
  [101.45, 102.28, 101.41, 101.56, 1.148],
  [101.56, 101.56, 100.23, 101.06, 2.852],
  [101.06, 105.05, 99.97, 103.15, 9.701],
  [103.15, 103.85, 100.23, 103.14, 1.278],
  [103.14, 104.99, 102.37, 102.45, 4.177],
  [102.45, 102.8, 101.17, 101.88, 1.71],
  [101.88, 102.83, 99.3, 102.29, 1.152],
  [102.29, 102.5, 100.41, 100.89, 6.247],
  [100.89, 104.66, 100.18, 103.93, 10.98],
  [103.93, 104.72, 102.59, 104.51, 2.381],
  [104.51, 104.67, 103.67, 103.94, 1.827],
  [103.94, 105.44, 100.12, 101.09, 7.741],
  [101.09, 101.34, 100.8, 101.19, 0.717],
  [101.19, 102.03, 100.97, 101.43, 1.456],
  [101.43, 103.65, 100.63, 103.55, 9.416],
  [103.55, 105.27, 100.83, 103.95, 1.133],
  [103.95, 107.16, 103.42, 106.19, 8.923],
  [106.19, 108.27, 99.83, 102.23, 14.319],
  [102.23, 102.99, 99.13, 102.87, 5.12],
  [102.87, 106.42, 101.81, 104.6, 4.077],
  [104.6, 114.89, 94.42, 112.99, 23.815],
  [112.99, 114.7, 106.32, 110.64, 7.035],
  [110.64, 110.92, 103.4, 110.01, 1.951],
  [114.96, 120.63, 114.47, 116.09, 8.87],
  [116.09, 124.94, 114.27, 117.56, 6.574],
  [117.56, 121.43, 113.66, 113.71, 7.403],
  [113.71, 115.95, 113.31, 114.82, 3.307],
  [114.82, 115.95, 114.59, 115.54, 5.189],
  [115.54, 118.64, 115.19, 116.95, 3.921],
  [116.95, 118.54, 115.77, 117.95, 3.575],
  [117.95, 120.91, 117.68, 119.03, 4.061],
  [119.03, 119.23, 114.21, 115.66, 10.093]
]);

/* ---------- fonts ---------- */
const FAMILY = {
  serif: "ZZ Invite Serif",
  monoCjk: "ZZ Invite Mono CJK",
  plex: "ZZ Invite Plex",
};
const FONT_FILES = [
  [FAMILY.serif, "invite-serif-regular.woff2", "400"],
  [FAMILY.serif, "invite-serif-bold.woff2", "700"],
  [FAMILY.monoCjk, "invite-mono-cjk.woff2", "400"],
  [FAMILY.plex, "invite-plex-mono.woff2", "400"],
  [FAMILY.plex, "invite-plex-mono-bold.woff2", "700"],
];
// Subset fonts carry the fixed copy + ASCII; any other glyph (a CJK nickname)
// falls through to the system fonts after them.
export const STACK = Object.freeze({
  serif: `"${FAMILY.serif}","Noto Serif CJK SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif`,
  monoCjk: `"${FAMILY.monoCjk}","Noto Sans Mono CJK SC","Noto Sans CJK SC","PingFang SC",monospace`,
  plex: `"${FAMILY.plex}","IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace`,
});

let fontsReady = null;
/** Loads the subset faces once; resolves { loaded, failed } and never rejects. */
export function loadInviteFonts({ timeoutMs = 3000, doc = typeof document !== "undefined" ? document : null } = {}) {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (!doc?.fonts || typeof FontFace !== "function") return { loaded: 0, failed: FONT_FILES.length };
    const jobs = FONT_FILES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(assets/pvp/share/${file}?v=${V}) format("woff2")`, { weight, display: "block" });
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error("font timeout")), timeoutMs));
      await Promise.race([face.load(), timer]);
      doc.fonts.add(face);
    });
    const out = await Promise.allSettled(jobs);
    const failed = out.filter((r) => r.status === "rejected").length;
    if (failed) fontsReady = null; // let the next save try again
    return { loaded: out.length - failed, failed };
  })();
  return fontsReady;
}

/* ---------- pure helpers (unit tested) ---------- */
export function lastOhlc(bars) {
  const b = bars[bars.length - 1];
  return { open: b[0], high: b[1], low: b[2], close: b[3] };
}

export function ohlcText(bars) {
  const { open, high, low, close } = lastOhlc(bars);
  const f = (v) => Number(v).toFixed(2);
  return `开 ${f(open)}  高 ${f(high)}  低 ${f(low)}  收 ${f(close)}`;
}

export function movingAverage(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k += 1) sum += closes[k];
    return sum / period;
  });
}

export const isUp = (bar) => bar[3] >= bar[0];

/** User-perceived characters, so an emoji sequence is never cut in half. */
export function graphemes(s) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

/** Truncates `text` with … so measure(text) ≤ maxWidth. measure: (s) => px. */
export function truncateToWidth(text, maxWidth, measure) {
  const s = String(text ?? "");
  if (measure(s) <= maxWidth) return s;
  const chars = graphemes(s);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("").trimEnd() + "…") <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return lo ? chars.slice(0, lo).join("").trimEnd() + "…" : "…";
}

/** Two-line headline: break after the last ，？！ that keeps line 1 ≤ maxWidth. */
export function splitHeadline(text, maxWidth, measure) {
  const s = String(text);
  if (measure(s) <= maxWidth) return [s];
  const chars = Array.from(s);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    if ("，,？?！!、。；;".includes(chars[i - 1])) {
      const a = chars.slice(0, i).join("");
      if (measure(a) <= maxWidth) return [a, chars.slice(i).join("").trimStart()];
    }
  }
  let i = chars.length;
  while (i > 1 && measure(chars.slice(0, i).join("")) > maxWidth) i -= 1;
  return [chars.slice(0, i).join(""), chars.slice(i).join("")];
}

/* ---------- drawing ---------- */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

function font(ctx, stack, size, weight = 400) {
  ctx.font = `${weight} ${size}px ${stack}`;
}

/** Text with manual letter spacing (canvas letterSpacing is not on every WebView). */
function spaced(ctx, text, x, y, spacing = 0, align = "left") {
  const chars = Array.from(text);
  if (!spacing) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
    return;
  }
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
  ctx.textAlign = "left";
  chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + spacing; });
}

/** Centres the ink of `text` on (cx, cy). */
function inkCentered(ctx, text, cx, cy) {
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent || 0;
  const desc = m.actualBoundingBoxDescent || 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, cx, cy + (asc - desc) / 2);
  ctx.textAlign = "left";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const CHART = Object.freeze({ x0: 93, y0: 488, x1: 987, y1: 968, volFrac: 0.2, pad: 0.06, rows: 4, cols: 6, bodyFrac: 0.62 });

function drawChart(ctx, bars) {
  const { x0, y0, x1, y1 } = CHART;
  // Cover the art's baked sample chart; the panel interior is flat #FFFAF0.
  ctx.fillStyle = C.panel;
  ctx.fillRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  ctx.clip();
  const n = bars.length;
  const pitch = (x1 - x0) / n;
  const X = (i) => x0 + (i + 0.5) * pitch;
  const vh = (y1 - y0) * CHART.volFrac;
  const py0 = y0;
  const py1 = y1 - vh - (y1 - y0) * 0.03;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b[2]); hi = Math.max(hi, b[1]); }
  const rg = hi - lo || 1;
  lo -= rg * CHART.pad;
  hi += rg * CHART.pad;
  const Y = (p) => py1 - ((p - lo) / (hi - lo)) * (py1 - py0);
  const lw = Math.max(1, pitch * 0.11);
  const bw = pitch * CHART.bodyFrac;

  // grid
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = C.ink;
  for (let r = 0; r <= CHART.rows; r += 1) ctx.fillRect(x0, Math.round(py0 + ((py1 - py0) * r) / CHART.rows) - 1, x1 - x0, 2);
  for (let c = 0; c <= CHART.cols; c += 1) ctx.fillRect(Math.round(x0 + ((x1 - x0) * c) / CHART.cols) - 1, py0, 2, y1 - py0);
  ctx.fillRect(x0, y1 - 1, x1 - x0, 2);

  // volume: each bar takes its own candle's colour
  ctx.globalAlpha = 0.55;
  let vmax = 0;
  for (const b of bars) vmax = Math.max(vmax, b[4]);
  bars.forEach((b, i) => {
    ctx.fillStyle = isUp(b) ? C.up : C.down;
    const top = y1 - vh * Math.max(0.08, b[4] / (vmax || 1));
    ctx.fillRect(X(i) - bw / 2, top, bw, y1 - top);
  });
  ctx.globalAlpha = 1;

  // wicks, then bodies (ink outline, colour fill)
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = lw;
  ctx.lineCap = "butt";
  bars.forEach((b, i) => {
    ctx.beginPath();
    ctx.moveTo(X(i), Y(b[1]));
    ctx.lineTo(X(i), Y(b[2]));
    ctx.stroke();
  });
  const rad = Math.max(1, lw * 0.8);
  bars.forEach((b, i) => {
    let t = Y(Math.max(b[0], b[3]));
    let bt = Y(Math.min(b[0], b[3]));
    if (bt - t < lw * 2.2) { const m = (t + bt) / 2; t = m - lw * 1.1; bt = m + lw * 1.1; }
    ctx.fillStyle = C.ink;
    roundRect(ctx, X(i) - bw / 2, t, bw, bt - t, rad);
    ctx.fill();
    if (bt - t > lw * 2.2 + 0.5) {
      ctx.fillStyle = isUp(b) ? C.up : C.down;
      roundRect(ctx, X(i) - bw / 2 + lw, t + lw, bw - 2 * lw, bt - t - 2 * lw, Math.max(0, rad - lw / 2));
      ctx.fill();
    }
  });

  // MA5 / MA10
  const closes = bars.map((b) => b[3]);
  for (const [period, color] of [[5, C.ma5], [10, C.ma10]]) {
    const ma = movingAverage(closes, period);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    ma.forEach((v, i) => {
      if (v == null) return;
      if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
    });
    ctx.stroke();
  }
  ctx.restore();
}

async function drawAvatar(ctx, sources, cx, cy, r) {
  for (const src of sources.filter(Boolean)) {
    try {
      const img = await loadImage(src);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
      ctx.clip();
      const s = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.restore();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
      ctx.stroke();
      return src;
    } catch {
      /* try the next source; the art's empty ring stays if all fail */
    }
  }
  return null;
}

async function qrModules(text) {
  const { default: qrcode } = await importWithRetry(
    "qrcode",
    () => import("../vendor/qrcode.js"),
    () => new URL("../vendor/qrcode.js", import.meta.url).href,
  );
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}

function drawQr(ctx, qr, scale) {
  const [bx, by, bs] = [73, 1206, 178];
  ctx.fillStyle = C.white;
  roundRect(ctx, bx, by, bs, bs, 14);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 4;
  roundRect(ctx, bx + 2, by + 2, bs - 4, bs - 4, 12);
  ctx.stroke();
  // Whole device pixels per module and ≥ 4 modules of quiet zone inside the border.
  const inner = (bs - 8) * scale;
  const mod = Math.floor(inner / (qr.n + 8));
  const size = mod * qr.n;
  const ox = Math.round((bx + bs / 2) * scale - size / 2);
  const oy = Math.round((by + bs / 2) * scale - size / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  for (let r = 0; r < qr.n; r += 1) {
    for (let c = 0; c < qr.n; c += 1) if (qr.dark(r, c)) ctx.fillRect(ox + c * mod, oy + r * mod, mod, mod);
  }
  ctx.restore();
  return { modulePx: mod, quietModules: (inner - size) / 2 / mod };
}

/**
 * Renders the S6 invite card. Never needs the DOM tree; needs fonts + images.
 * @returns {Promise<{ canvas: HTMLCanvasElement, info: object }>}
 */
export async function renderInviteCardS6({
  url,
  nickname = "我",
  avatarSources = [],
  scale = 2,
  bars = S6_SAMPLE_BARS,
  headline = PVP_INVITE_SHARE_TEXT,
  doc = document,
} = {}) {
  if (!url) throw new Error("missing invite url");
  const fonts = await loadInviteFonts({ doc });
  const [bg, qr] = await Promise.all([
    loadImage(S6_ART.background[scale >= 2 ? 2 : 1]),
    qrModules(url),
  ]);
  const canvas = doc.createElement("canvas");
  canvas.width = S6_ART.width * scale;
  canvas.height = S6_ART.height * scale;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bg, 0, 0, S6_ART.width, S6_ART.height);
  ctx.textBaseline = "alphabetic";

  // header
  ctx.fillStyle = C.grey;
  font(ctx, STACK.serif, 30, 400);
  spaced(ctx, "双人对战 · 邀请", 73, 92, 9);
  ctx.fillStyle = C.ink;
  font(ctx, STACK.serif, 30, 700);
  spaced(ctx, MASKED_STOCK_LABEL, 1007, 92, 0, "right");
  ctx.fillStyle = C.grey;
  font(ctx, STACK.monoCjk, 23, 400);
  ctx.fillText(SAMPLE_CAPTION, 73, 140);

  // headline (the one invite text constant)
  ctx.fillStyle = C.ink;
  let size = 64;
  font(ctx, STACK.serif, size, 700);
  let lines = splitHeadline(headline, 934, (s) => ctx.measureText(s).width);
  while (size > 44 && (lines.length > 2 || lines.some((l) => ctx.measureText(l).width > 934))) {
    size -= 2;
    font(ctx, STACK.serif, size, 700);
    lines = splitHeadline(headline, 934, (s) => ctx.measureText(s).width);
  }
  const baselines = lines.length === 1 ? [276] : [234, 318.48];
  lines.slice(0, 2).forEach((line, i) => ctx.fillText(line, 73, baselines[i]));

  // tabs (pill for 日K is in the art)
  [["分时", 158], ["日K", 288], ["周K", 418], ["月K", 548], ["五日", 678]].forEach(([t, x], k) => {
    ctx.fillStyle = k === 1 ? C.paper : C.grey;
    font(ctx, STACK.serif, 24, k === 1 ? 700 : 400);
    spaced(ctx, t, x, 406, 0, "center");
  });

  // O/H/L/C strip from the bars shown + MA legend (swatches are in the art)
  ctx.fillStyle = C.grey2;
  font(ctx, STACK.monoCjk, 22, 400);
  const strip = ohlcText(bars);
  ctx.fillText(strip, 101, 472);
  font(ctx, STACK.plex, 20, 400);
  ctx.fillStyle = C.ma5;
  ctx.fillText("MA5", 835, 472);
  ctx.fillStyle = C.ma10;
  ctx.fillText("MA10", 931, 472);

  drawChart(ctx, bars);

  // players
  const avatar = await drawAvatar(ctx, avatarSources, 151, 1093, 50);
  ctx.fillStyle = C.grey;
  font(ctx, STACK.serif, 26, 400);
  spaced(ctx, "我", 227, 1081, 3);
  ctx.fillStyle = C.ink;
  font(ctx, STACK.serif, 38, 700);
  const name = truncateToWidth(String(nickname || "我").replace(/\s+/g, " ").trim() || "我", 476 - 227, (s) => ctx.measureText(s).width);
  ctx.fillText(name, 227, 1129);

  ctx.fillStyle = C.grey;
  font(ctx, STACK.serif, 55, 700);
  inkCentered(ctx, "?", 658, 1095);
  font(ctx, STACK.serif, 26, 400);
  spaced(ctx, "挑战者", 734, 1081, 3);
  ctx.fillStyle = C.grey2;
  font(ctx, STACK.serif, 38, 700);
  ctx.fillText("等你入局", 734, 1129);

  ctx.fillStyle = C.paper;
  font(ctx, STACK.plex, 26, 700);
  inkCentered(ctx, "VS", 540, 1093);

  // footer: real invite URL in the QR and as text
  const qrInfo = drawQr(ctx, qr, scale);
  ctx.fillStyle = C.ink;
  font(ctx, STACK.serif, 58, 700);
  spaced(ctx, S6_BRAND, 283, 1272, 6);
  ctx.fillStyle = C.grey2;
  font(ctx, STACK.serif, 26, 400);
  ctx.fillText(S6_SUBLINE, 283, 1326);
  let urlSize = 25;
  let shown = url;
  font(ctx, STACK.plex, urlSize, 400);
  if (ctx.measureText(shown).width > 724) shown = url.replace(/^https?:\/\//, "");
  while (urlSize > 18 && ctx.measureText(shown).width > 724) { urlSize -= 1; font(ctx, STACK.plex, urlSize, 400); }
  ctx.fillText(shown, 283, 1370);

  return { canvas, info: { fonts, avatar, name, strip, headlineLines: lines, urlShown: shown, urlSize, qr: { modules: qr.n, ...qrInfo }, scale } };
}
