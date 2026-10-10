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
