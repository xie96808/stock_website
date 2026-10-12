/**
 * Handcrafted controls helpers — docs/handcrafted-controls-redesign.md v1.2
 * P0: setCtlState, shakeError, showStampToast, castbar, overlay open/close.
 * P2 TODO: input shells / checkbox / modal-paper when 绘图bot delivers.
 */

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

const ASSET = (name) => `assets/controls/${name}`;

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
  toast.textContent = String(message || "");
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
function exitMs() {
  return preferReducedMotion() ? 100 : 200;
}

function lockScroll() {
  scrollLockCount += 1;
  document.body.classList.add("ctl-scroll-lock");
}
function unlockScroll() {
  // Recount live overlays (robust if some legacy path set hidden directly).
  scrollLockCount = document.querySelectorAll(".is-open:not([hidden]):not(.is-leaving)").length;
  if (scrollLockCount === 0) document.body.classList.remove("ctl-scroll-lock");
}

/**
 * Open a modal overlay already in the DOM (hidden attr).
 * Adds is-open, locks scroll, focuses close/primary.
 */
export function openCtlOverlay(overlay, opts = {}) {
  if (!overlay) return;
  overlay.classList.remove("is-leaving");
  overlayFocusPrev.set(overlay, document.activeElement);
  overlay.hidden = false;
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
  const ms = opts.ms ?? exitMs();
  return new Promise((resolve) => {
    window.setTimeout(() => {
      overlay.hidden = true;
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

let controlsInited = false;

export function initControls() {
  if (controlsInited) return;
  controlsInited = true;
  bindPressFeedback(document);
  // Release scroll lock if a legacy path hides an overlay directly.
  new MutationObserver(() => {
    if (!document.body.classList.contains("ctl-scroll-lock")) return;
    if (!document.querySelector(".is-open:not([hidden]):not(.is-leaving)")) {
      document.body.classList.remove("ctl-scroll-lock");
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
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
    setChallengeLoading,
    ctlAsset,
    initControls,
  };
}
