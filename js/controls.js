/**
 * Handcrafted controls helpers — docs/handcrafted-controls-redesign.md v1.2
 * P0: setCtlState, shakeError, showStampToast, castbar, overlay open/close.
 * Also: bottom sheets (openCtlSheet/closeCtlSheet) + crisis sheet (showCrisisSheet). P2 visuals are CSS-only.
 */
import { unitIconsHtml, hasUnitIcons } from "./unit-icons.js";

const CTL_STATES = new Set([
  "default",
  "hover",
  "press",
  "disabled",
  "locked",
  "loading",
  "success",
  "error",
]);

const ASSET_REV = "20261013s"; // bump when control art changes (cache-bust)
const ASSET = (name) => `assets/controls/${name}?v=${ASSET_REV}`;

/** Map ctl kind + state → asset path (webp preferred by CSS; PNG for <img>). */
export function ctlAsset(kind, state = "default", ext = "png") {
  const s = CTL_STATES.has(state) ? state : "default";
  return ASSET(`ctl-${kind}-${s}.${ext}`);
}

/**
 * Set atomic control state via data-state (+ optional disabled).
 * Does not rewrite the control type (loading keeps same shell).
 */
export function setCtlState(el, state, opts = {}) {
  if (!el) return;
  const next = CTL_STATES.has(state) ? state : "default";
  el.dataset.state = next;
  if (next === "disabled" || next === "locked" || next === "loading") {
    if (opts.forceDisabled !== false) el.disabled = true;
  } else if (opts.clearDisabled) {
    el.disabled = false;
  }
  if (next === "loading") {
    el.classList.add("is-busy");
    el.setAttribute("aria-busy", "true");
  } else if (opts.clearBusy !== false && next !== "loading") {
    el.classList.remove("is-busy");
    el.removeAttribute("aria-busy");
  }
  // Swap <img.chrome> / pvp-sketch-chrome when data-ctl-kind is set
  const kind = el.dataset.ctlKind || el.dataset.ctl;
  if (kind && (opts.syncImg !== false)) {
    const img =
      el.querySelector(".ctl-chrome, .pvp-sketch-chrome, .pvp-sketch-icon") ||
      (el.id === "pvpTradePrimaryImg" ? el : null);
    if (img && img.tagName === "IMG") {
      const mapState =
        next === "press" || next === "hover" || next === "error"
          ? next === "press"
            ? "press"
            : "default"
          : next === "default" || next === "success" || next === "loading" || next === "disabled" || next === "locked"
            ? next === "default"
              ? "default"
              : next
            : "default";
      // Prefer existing state frames; fall back to default if missing kind/state
      const frame =
        next === "success" && kind === "ready"
          ? "success"
          : next === "loading"
            ? kind === "challenge" || kind === "primary"
              ? "loading"
              : "default"
            : next === "disabled" || next === "locked" || next === "press"
              ? next
              : "default";
      img.src = ctlAsset(kind, frame, "png");
    }
  }
  if (next === "success" && opts.successMs) {
    window.setTimeout(() => {
      if (el.dataset.state === "success") setCtlState(el, "default", { clearDisabled: true });
    }, opts.successMs);
  }
}

/** X-axis ±4px shake 4× (~320ms) + optional error state flash. */
export function shakeError(el, opts = {}) {
  if (!el) return;
  el.classList.remove("is-shake", "ctl-shake");
  // reflow
  void el.offsetWidth;
  el.classList.add("is-shake");
  if (opts.setErrorState) setCtlState(el, "error", { clearDisabled: false, forceDisabled: false });
  window.setTimeout(() => {
    el.classList.remove("is-shake");
    if (opts.setErrorState && el.dataset.state === "error") {
      setCtlState(el, el.disabled ? "disabled" : "default", { clearDisabled: false, forceDisabled: false });
    }
  }, opts.ms || 320);
}

/**
 * Stamp toast using ctl-toast-* skins.
 * kind: success | error | info
 */
export function showStampToast(message, kind = "error") {
  const hostId = "authToastHost";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.className = "auth-toast-host";
    host.id = hostId;
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const k = kind === "success" || kind === "info" ? kind : "error";
  const toast = document.createElement("div");
  toast.className = `auth-toast ctl-toast ctl-toast--${k} auth-toast--${k}`;
  toast.setAttribute("role", "status");
  // 「50 韭币」「后悔券 ×2」 in a toast render as icons (text kept for screen readers); plain strings stay textContent
  const msg = String(message || "");
  if (hasUnitIcons(msg)) toast.innerHTML = unitIconsHtml(msg, { size: 14 });
  else toast.textContent = msg;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  const hold = 2200;
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 200);
  }, hold);
  toast.addEventListener("click", () => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 180);
  });
  return toast;
}

/** Ensure a castbar under host; returns { root, fill, setProgress, setIndeterminate, destroy }. */
export function ensureCastbar(host, opts = {}) {
  if (!host) return null;
  host.classList.add("ctl-loading-host");
  let root = host.querySelector(".ctl-castbar");
  if (!root) {
    root = document.createElement("div");
    root.className = "ctl-castbar";
    root.setAttribute("role", "progressbar");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("span");
    fill.className = "ctl-castbar-fill";
    root.appendChild(fill);
    if (opts.label !== false) {
      const label = document.createElement("p");
      label.className = "ctl-castbar-label";
      label.textContent = opts.labelText || host.textContent?.trim() || "加载中…";
      // Keep original text as label; clear raw-only text host if it's a bare <p>
      if (host.matches("p") && !host.querySelector(".ctl-castbar")) {
        host.textContent = "";
        host.appendChild(root);
        host.appendChild(label);
      } else {
        host.appendChild(root);
        if (opts.labelText) host.appendChild(label);
      }
    } else {
      host.appendChild(root);
    }
  }
  const fill = root.querySelector(".ctl-castbar-fill");
  const api = {
    root,
    fill,
    setProgress(pct) {
      root.classList.remove("is-indeterminate");
      const n = Math.max(0, Math.min(100, Number(pct) || 0));
      if (fill) fill.style.width = `${n}%`;
      root.setAttribute("aria-valuenow", String(Math.round(n)));
    },
    setIndeterminate(on = true) {
      root.classList.toggle("is-indeterminate", !!on);
      if (on && fill) fill.style.width = "38%";
      root.removeAttribute("aria-valuenow");
    },
    setLabel(text) {
      let label = host.querySelector(".ctl-castbar-label");
      if (!label) {
        label = document.createElement("p");
        label.className = "ctl-castbar-label";
        host.appendChild(label);
      }
      label.textContent = text || "";
    },
    destroy() {
      root.remove();
      host.classList.remove("ctl-loading-host");
    },
  };
  if (opts.indeterminate) api.setIndeterminate(true);
  return api;
}

/* ----- Overlay open/close with §6.4 timings ----- */
let scrollLockCount = 0;
const overlayFocusPrev = new WeakMap();

function preferReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function enterMs() {
  return preferReducedMotion() ? 120 : 250;
}
function exitMs(overlay) {
  if (preferReducedMotion()) return 100;
  return overlay && overlay.classList.contains("ctl-sheet") ? 220 : 200;
}

function lockScroll() {
  scrollLockCount += 1;
  document.body.classList.add("ctl-scroll-lock");
}
const OPEN_OVERLAY_SEL = ".is-open:not([hidden]):not(.is-leaving)";

/**
 * Overlays that are really on screen. `.is-open` is only an overlay marker, but a stray element carrying it
 * (e.g. inside a sheet that was closed) must never keep the page locked, so require the element to be rendered
 * (an element inside a display:none ancestor has no client rects).
 */
export function countOpenOverlays(root = document) {
  let n = 0;
  for (const el of root.querySelectorAll(OPEN_OVERLAY_SEL)) {
    if (el.getClientRects().length > 0) n += 1;
  }
  return n;
}

function unlockScroll() {
  // Recount live overlays (robust if some legacy path set hidden directly).
  scrollLockCount = countOpenOverlays();
  if (scrollLockCount === 0) document.body.classList.remove("ctl-scroll-lock");
}

/**
 * Open a modal overlay already in the DOM (hidden attr).
 * Adds is-open, locks scroll, focuses close/primary.
 */
/**
 * A quick double tap on a card opens an overlay with the first tap and lands
 * the second tap on the freshly shown backdrop, which closed it again (the
 * dialog "flashed" and nothing happened). For a short window after opening,
 * swallow clicks that hit the overlay outside its dialog panel.
 */
export const GHOST_TAP_GUARD_MS = 350;
const DIALOG_PANEL_SEL = '[role="dialog"], [role="alertdialog"], .ctl-panel';

export function isGhostTap(openedAt, now, insidePanel, ms = GHOST_TAP_GUARD_MS) {
  if (insidePanel || !Number.isFinite(openedAt)) return false;
  return now - openedAt < ms;
}

function armGhostTapGuard(overlay) {
  overlay._ctlOpenedAt = performance.now();
  if (overlay._ctlGhostGuard) return;
  overlay._ctlGhostGuard = true;
  overlay.addEventListener(
    "click",
    (e) => {
      const inside = !!(e.target && e.target.closest && e.target.closest(DIALOG_PANEL_SEL));
      if (isGhostTap(overlay._ctlOpenedAt, performance.now(), inside)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );
}

export function openCtlOverlay(overlay, opts = {}) {
  if (!overlay) return;
  if (!overlay.hidden && overlay.classList.contains("is-open") && !overlay.classList.contains("is-leaving")) return;
  if (overlay._ctlCloseTimer) {
    window.clearTimeout(overlay._ctlCloseTimer);
    overlay._ctlCloseTimer = null;
    overlay._ctlCloseResolve?.();
  }
  overlay.classList.remove("is-leaving");
  armGhostTapGuard(overlay);
  overlayFocusPrev.set(overlay, document.activeElement);
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  if (opts.sheet) overlay.classList.add("ctl-sheet");
  // force reflow before is-open so enter anim plays
  void overlay.offsetWidth;
  overlay.classList.add("is-open");
  lockScroll();
  const focusSel =
    opts.focusSelector ||
    "[data-ctl-focus], .auth-close, .feedback-close, .announcements-close, .pvp-btn-primary, button.ctl-primary, button";
  window.setTimeout(() => {
    const node = overlay.querySelector(focusSel);
    try {
      node?.focus?.();
    } catch {
      /* ignore */
    }
  }, Math.min(enterMs(), 80));
}

/** Close overlay with exit anim then hidden. */
export function closeCtlOverlay(overlay, opts = {}) {
  if (!overlay || overlay.hidden) return Promise.resolve();
  if (overlay.classList.contains("is-leaving")) return Promise.resolve();
  overlay.classList.add("is-leaving");
  overlay.classList.remove("is-open");
  const ms = opts.ms ?? exitMs(overlay);
  return new Promise((resolve) => {
    overlay._ctlCloseResolve = resolve;
    overlay._ctlCloseTimer = window.setTimeout(() => {
      overlay._ctlCloseTimer = null;
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.remove("is-leaving");
      unlockScroll();
      const prev = overlayFocusPrev.get(overlay);
      overlayFocusPrev.delete(overlay);
      if (opts.restoreFocus !== false && prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
      resolve();
    }, ms);
  });
}

/** Wire press visual that always fires within 120ms (pointerdown). */
export function bindPressFeedback(root = document) {
  const selector = ".ctl, .action-btn, .pvp-btn, .pvp-sketch-ctl";
  const onDown = (e) => {
    const el = e.target?.closest?.(selector);
    if (!el || el.disabled || el.dataset.state === "disabled" || el.dataset.state === "locked") return;
    if (el.dataset.state === "loading") return;
    el.dataset.state = "press";
  };
  const onUp = (e) => {
    const el = e.target?.closest?.(selector);
    if (!el) return;
    if (el.dataset.state === "press") {
      const kind = el.dataset.ctlKind || el.dataset.ctl;
      // restore logical state from disabled/locked/loading classes
      if (el.classList.contains("is-busy") || el.getAttribute("aria-busy") === "true") {
        el.dataset.state = "loading";
      } else if (el.disabled) {
        el.dataset.state = el.dataset.ctlLocked === "1" ? "locked" : "disabled";
      } else {
        el.dataset.state = "default";
      }
      void kind;
    }
  };
  root.addEventListener("pointerdown", onDown, true);
  root.addEventListener("pointerup", onUp, true);
  root.addEventListener("pointercancel", onUp, true);
  root.addEventListener("lostpointercapture", onUp, true);
}

/** Sync disabled/locked trade control frames from boolean flags. */
export function syncTradeCtl(el, { kind, disabled, locked } = {}) {
  if (!el) return;
  if (kind) {
    el.dataset.ctlKind = kind;
    el.dataset.ctl = kind;
    el.classList.remove("ctl-buy", "ctl-sell", "ctl-hold", "ctl-msg");
    el.classList.add(`ctl-${kind}`);
  }
  if (locked) {
    el.dataset.ctlLocked = "1";
    setCtlState(el, "locked", { syncImg: true });
  } else if (disabled) {
    el.dataset.ctlLocked = "0";
    setCtlState(el, "disabled", { syncImg: true });
  } else {
    el.dataset.ctlLocked = "0";
    el.disabled = false;
    setCtlState(el, "default", { clearDisabled: true, syncImg: true });
  }
}

/** Mark lobby challenge button loading while request in flight. */
export function setChallengeLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    setCtlState(btn, "loading", { syncImg: true });
  } else {
    setCtlState(btn, "default", { clearDisabled: true, syncImg: true });
  }
}

/* ----- Bottom sheets (§6.4: enter 260ms / exit 220ms; crisis = top, no backdrop dismiss) ----- */
export function openCtlSheet(overlay, opts = {}) {
  openCtlOverlay(overlay, { ...opts, sheet: true });
}
export function closeCtlSheet(overlay, opts = {}) {
  return closeCtlOverlay(overlay, opts);
}

/**
 * Crisis sheet (断线/限额/资格): highest z-index, backdrop click does NOT close.
 * actions: [{ label, kind: "primary"|"secondary"|"danger", onClick }]
 */
export function showCrisisSheet({ title = "", body = "", actions = [] } = {}) {
  let root = document.getElementById("ctlCrisisSheet");
  if (!root) {
    root = document.createElement("div");
    root.id = "ctlCrisisSheet";
    root.className = "ctl-overlay ctl-sheet ctl-crisis";
    root.hidden = true;
    root.innerHTML = `<div class="ctl-panel ctl-sheet-panel ctl-paper" role="alertdialog" aria-modal="true" aria-labelledby="ctlCrisisTitle" aria-describedby="ctlCrisisBody">
        <h2 id="ctlCrisisTitle"></h2><p id="ctlCrisisBody"></p><div class="ctl-sheet-actions" id="ctlCrisisActions"></div></div>`;
    // Backdrop click intentionally ignored (强制确认).
    root.addEventListener("click", (e) => {
      if (e.target === root) shakeError(root.querySelector(".ctl-panel"));
    });
    document.body.appendChild(root);
  }
  root.querySelector("#ctlCrisisTitle").textContent = title;
  root.querySelector("#ctlCrisisBody").textContent = body;
  const box = root.querySelector("#ctlCrisisActions");
  box.textContent = "";
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    const kind = a.kind || "primary";
    b.className = `ctl ctl-${kind}`;
    b.dataset.ctlKind = kind;
    b.dataset.state = "default";
    const s = document.createElement("span");
    s.className = "ctl-label";
    s.textContent = a.label || "好";
    b.appendChild(s);
    b.addEventListener("click", () => {
      if (a.close !== false) hideCrisisSheet();
      a.onClick?.();
    });
    box.appendChild(b);
  }
  if (root.hidden) openCtlSheet(root, { focusSelector: "#ctlCrisisActions button" });
  return root;
}
export function hideCrisisSheet() {
  const root = document.getElementById("ctlCrisisSheet");
  if (root && !root.hidden) return closeCtlSheet(root);
  return Promise.resolve();
}

/**
 * 手绘确认 sheet，替代 window.confirm。返回 Promise<boolean>：
 * 确定 → true；取消 / Esc / 点遮罩 → false。只 resolve 一次。
 */
let confirmPending = null;
export function ctlConfirm(message, { title = "", okLabel = "确定", cancelLabel = "取消", danger = false } = {}) {
  let root = document.getElementById("ctlConfirmSheet");
  if (!root) {
    root = document.createElement("div");
    root.id = "ctlConfirmSheet";
    root.className = "ctl-overlay ctl-sheet ctl-confirm";
    root.hidden = true;
    root.innerHTML = `<div class="ctl-panel ctl-sheet-panel ctl-paper" role="alertdialog" aria-modal="true" aria-labelledby="ctlConfirmTitle" aria-describedby="ctlConfirmBody">
        <h2 id="ctlConfirmTitle"></h2><p id="ctlConfirmBody"></p><div class="ctl-sheet-actions">
        <button type="button" class="ctl ctl-secondary" data-ctl-kind="secondary" data-state="default" id="ctlConfirmCancel"><span class="ctl-label"></span></button>
        <button type="button" class="ctl ctl-primary" data-ctl-kind="primary" data-state="default" id="ctlConfirmOk" data-ctl-focus><span class="ctl-label"></span></button></div></div>`;
    root.addEventListener("click", (e) => { if (e.target === root) settleConfirm(false); });
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); settleConfirm(false); } });
    root.querySelector("#ctlConfirmOk").addEventListener("click", () => settleConfirm(true));
    root.querySelector("#ctlConfirmCancel").addEventListener("click", () => settleConfirm(false));
    document.body.appendChild(root);
  }
  // 若上一次确认尚未作答，按取消处理，避免悬挂的 Promise。
  if (confirmPending) settleConfirm(false);
  const t = root.querySelector("#ctlConfirmTitle");
  t.textContent = title;
  t.hidden = !title;
  const body = root.querySelector("#ctlConfirmBody");
  const msg = String(message ?? "");
  if (hasUnitIcons(msg)) body.innerHTML = unitIconsHtml(msg, { size: 16 });
  else body.textContent = msg;
  root.querySelector("#ctlConfirmOk .ctl-label").textContent = okLabel;
  root.querySelector("#ctlConfirmCancel .ctl-label").textContent = cancelLabel;
  const ok = root.querySelector("#ctlConfirmOk");
  ok.className = `ctl ${danger ? "ctl-danger" : "ctl-primary"}`;
  ok.dataset.ctlKind = danger ? "danger" : "primary";
  return new Promise((resolve) => {
    confirmPending = resolve;
    openCtlSheet(root, { focusSelector: "#ctlConfirmOk" });
  });
}
function settleConfirm(value) {
  const r = confirmPending;
  if (!r) return;
  confirmPending = null;
  closeCtlSheet(document.getElementById("ctlConfirmSheet"));
  r(value);
}

let controlsInited = false;

export function initControls() {
  if (controlsInited) return;
  controlsInited = true;
  bindPressFeedback(document);
  // Release scroll lock if a legacy path hides an overlay directly.
  new MutationObserver(() => {
    if (!document.body.classList.contains("ctl-scroll-lock")) return;
    if (countOpenOverlays() === 0) {
      document.body.classList.remove("ctl-scroll-lock");
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  // 断线危机层：离线时弹出强制 sheet，恢复后自动收起。
  window.addEventListener("offline", () => {
    showCrisisSheet({
      title: "网络断开了",
      body: "正在等待网络恢复。恢复后会自动继续，对局计时以服务器为准。",
      actions: [{ label: "我知道了", kind: "secondary" }],
    });
  });
  window.addEventListener("online", () => { hideCrisisSheet(); showStampToast("网络已恢复", "success"); });
  // Enhance lobby loading + fill loading with castbar when shown
  const lobbyLoading = document.getElementById("pvpLobbyLoading");
  if (lobbyLoading) {
    const obs = new MutationObserver(() => {
      if (!lobbyLoading.hidden) {
        const bar = ensureCastbar(lobbyLoading, {
          indeterminate: true,
          labelText: "大厅加载中…",
        });
        bar?.setIndeterminate(true);
      }
    });
    obs.observe(lobbyLoading, { attributes: true, attributeFilter: ["hidden"] });
  }
  const fillLoading = document.getElementById("fillModeLoadingPane");
  if (fillLoading) {
    fillLoading.classList.add("ctl-loading-host");
    // Prefer existing fill bar; skin track via CSS class hook
    const shell = fillLoading.querySelector(".fill-load-bar");
    if (shell) shell.classList.add("ctl-castbar-host");
  }
}

// Browser global for non-module call sites
if (typeof window !== "undefined") {
  window.__stockControls = {
    setCtlState,
    shakeError,
    showStampToast,
    ensureCastbar,
    openCtlOverlay,
    closeCtlOverlay,
    syncTradeCtl,
    openCtlSheet,
    closeCtlSheet,
    showCrisisSheet,
    hideCrisisSheet,
    setChallengeLoading,
    ctlAsset,
    initControls,
  };
}
