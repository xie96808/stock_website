/**
 * Home-hub Android APK download entry visibility.
 * Pure helpers so Node tests can cover iOS / in-app / other without a DOM.
 */

/** Stable download URL (nginx aliases /srv/stock-website/downloads/). */
export const APK_DOWNLOAD_HREF = "/download/stockgame.apk";

/**
 * True when running inside the Android WebView shell.
 * The shell injects `window.StockGameApp` via addJavascriptInterface before page load.
 */
export function hasStockGameAppBridge(win = typeof window !== "undefined" ? window : undefined) {
  return !!(win && win.StockGameApp);
}

/**
 * Apple device: classic iPhone/iPod/iPad UA, plus iPadOS desktop UA
 * (Macintosh + touch).
 */
export function isAppleTouchDevice(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
  maxTouchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
) {
  const ua = String(userAgent || "");
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS 13+ often reports as MacIntel with touch
  if (/Macintosh/i.test(ua) && Number(maxTouchPoints) > 1) return true;
  return false;
}

/**
 * @returns {'hidden' | 'ios-hint' | 'download'}
 * - hidden: inside Android App shell (bridge present)
 * - ios-hint: Apple device — show Safari → 添加到主屏幕 tip, no APK
 * - download: desktop / Android browser — show APK link
 */
export function apkDownloadMode({
  hasAppBridge = false,
  userAgent = "",
  maxTouchPoints = 0,
} = {}) {
  if (hasAppBridge) return "hidden";
  if (isAppleTouchDevice(userAgent, maxTouchPoints)) return "ios-hint";
  return "download";
}

/**
 * Apply mode to home-hub entry nodes.
 * @param {Document} [doc]
 * @param {{ hasAppBridge?: boolean, userAgent?: string, maxTouchPoints?: number }} [env]
 */
export function applyApkDownloadEntry(doc = typeof document !== "undefined" ? document : null, env) {
  if (!doc) return "hidden";
  const root = doc.getElementById("apkDownloadEntry");
  if (!root) return "hidden";

  const bridge =
    env?.hasAppBridge ??
    hasStockGameAppBridge(typeof window !== "undefined" ? window : undefined);
  const ua =
    env?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const mtp =
    env?.maxTouchPoints ??
    (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);

  const mode = apkDownloadMode({ hasAppBridge: bridge, userAgent: ua, maxTouchPoints: mtp });
  const link = doc.getElementById("apkDownloadLink");
  const tip = doc.getElementById("apkDownloadTip");
  const iosHint = doc.getElementById("apkIosHint");

  if (mode === "hidden") {
    root.hidden = true;
    return mode;
  }

  root.hidden = false;
  if (mode === "ios-hint") {
    if (link) link.hidden = true;
    if (tip) tip.hidden = true;
    if (iosHint) iosHint.hidden = false;
  } else {
    if (link) link.hidden = false;
    if (tip) tip.hidden = false;
    if (iosHint) iosHint.hidden = true;
  }
  return mode;
}

/**
 * Android shell ≥ 1.0.3 exposes checkUpdate()/getVersion() on the bridge.
 * Older shells (bridge without checkUpdate) and browsers → false.
 */
export function hasAppUpdateBridge(win = typeof window !== "undefined" ? window : undefined) {
  const app = win && win.StockGameApp;
  return !!app && typeof app.checkUpdate === "function";
}

/** Read the shell's versionName; "" when unavailable or the call throws. */
export function readAppVersion(win = typeof window !== "undefined" ? window : undefined) {
  try {
    const app = win && win.StockGameApp;
    if (!app || typeof app.getVersion !== "function") return "";
    const v = app.getVersion();
    return typeof v === "string" ? v.slice(0, 32) : "";
  } catch {
    return "";
  }
}

/**
 * Show 「检查更新 / 当前版本 x.y.z」 only inside an updater-capable shell.
 * No-op (entry stays hidden) on web / desktop.
 * @returns {boolean} whether the entry is shown
 */
export function applyAppUpdateEntry(
  doc = typeof document !== "undefined" ? document : null,
  win = typeof window !== "undefined" ? window : undefined,
) {
  if (!doc) return false;
  const root = doc.getElementById("appUpdateEntry");
  if (!root) return false;
  if (!hasAppUpdateBridge(win)) {
    root.hidden = true;
    return false;
  }
  const ver = readAppVersion(win);
  const label = doc.getElementById("appUpdateVersion");
  if (label) label.textContent = ver ? `当前版本 ${ver}` : "";
  const btn = doc.getElementById("appUpdateBtn");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      try {
        win.StockGameApp.checkUpdate();
      } catch {
        /* bridge gone; ignore */
      }
    });
  }
  root.hidden = false;
  return true;
}
