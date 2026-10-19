/** 韭币 client: balance chrome + daily claim beside auth chip */
import { api, getAuthState, showToast, selectIsAuthenticated } from "./auth.js";
import { importWithRetry } from "./lazy-import.js";
import { coinIconHtml, installIconArtFallback, preloadIconArt } from "./icon-art.js";

/** Shared coin markup (auth chrome, price badges, modals): drawn art in the old 0.95em box, SVG fallback. */
export { coinIconHtml };

/** Number + coin icon (icon after amount). */
export function amountWithCoinHtml(amount, { size = 12 } = {}) {
  const n = amount == null ? "" : String(amount);
  return `<span class="jiu-coin-amt"><span class="jiu-price-num">${n}</span>${coinIconHtml({ size })}</span>`;
}

let claimBusy = false;

/* ---- 幸运转盘 entry (replaces the 每日领取 button in place while the server flag is ON) ----
 * `wheelMode` is true only when GET /me/jiu-coin returned `wheel.enabled`; an API without the field keeps the legacy flow.
 * A one-bit localStorage hint avoids a 每日领取→幸运转盘 flash on reload; the next status response corrects it. */
const WHEEL_HINT_KEY = "stockgame.lw.entry";
function readWheelHint() {
  try {
    return window.localStorage.getItem(WHEEL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function writeWheelHint(on) {
  try {
    if (on) window.localStorage.setItem(WHEEL_HINT_KEY, "1");
    else window.localStorage.removeItem(WHEEL_HINT_KEY);
  } catch {
    /* ignore */
  }
}
let wheelMode = readWheelHint();
let wheelRemaining = null;
let wheelOpening = false;

function paintWheelEntry(btn) {
  if (!btn) return;
  const on = wheelMode;
  btn.classList.toggle("is-wheel", on);
  if (!on) {
    btn.querySelectorAll(".lw-entry-ico, .lw-entry-dot").forEach((n) => n.remove());
    btn.classList.remove("has-spins");
    btn.title = "每日领取韭币";
    btn.setAttribute("aria-label", "每日领取韭币");
    return;
  }
  btn.disabled = false;
  btn.classList.remove("is-claimed");
  if (!btn.querySelector(".lw-entry-ico")) {
    const ico = document.createElement("span");
    ico.className = "lw-entry-ico";
    ico.setAttribute("aria-hidden", "true");
    btn.insertBefore(ico, btn.firstChild);
  }
  if (!btn.querySelector(".lw-entry-dot")) {
    const dot = document.createElement("i");
    dot.className = "lw-entry-dot";
    dot.setAttribute("aria-hidden", "true");
    btn.appendChild(dot);
  }
  let full = btn.querySelector(".jiu-daily-full");
  let short = btn.querySelector(".jiu-daily-short");
  if (!full || !short) {
    full = document.createElement("span");
    full.className = "jiu-daily-full";
    short = document.createElement("span");
    short.className = "jiu-daily-short";
    btn.append(full, short);
  }
  full.textContent = WHEEL_ENTRY_LABEL;
  // ≤640px: the same name on two short lines inside the old box (css/lucky-wheel.css), so no neighbour moves
  if (!short.querySelector(".lw-entry-l2")) short.innerHTML = '<span class="lw-entry-l1">签到</span><span class="lw-entry-l2">幸运转盘</span>';
  const has = wheelRemaining == null ? false : wheelRemaining > 0;
  btn.classList.toggle("has-spins", has);
  btn.title = has ? `${WHEEL_ENTRY_LABEL} · 今日还有 ${wheelRemaining} 次免费机会` : WHEEL_ENTRY_LABEL;
  btn.setAttribute("aria-label", btn.title);
  scheduleWheelWarm(btn);
}

/* ---- cold-open performance: warm the wheel in the background once the entry is painted ----
 * After the entry shows (logged in, wheel mode) we wait for an idle moment, then: import lucky-wheel.js (+ its helper, both also
 * <link rel="modulepreload">ed in index.html), GET /me/lucky-wheel, and hand the state to the module, which builds the hidden
 * modal so its art loads. Hover / pointerdown / touchstart on the entry starts the same warm-up at once. A click that beats the
 * warm-up still overlaps the state GET with the module import (openWheelFromEntry). */
const WHEEL_ENTRY_LABEL = "签到幸运转盘";
const WHEEL_STATE_FRESH_MS = 20000;
let wheelModP = null;
let wheelPrefetch = null; // { promise, at, uid }
let wheelWarmed = null; // user id the warm-up ran for
let wheelWarmTimer = 0;

function loadWheelModule() {
  if (!wheelModP) {
    wheelModP = importWithRetry(
      "lucky-wheel",
      () => import("./lucky-wheel.js"),
      () => new URL("./lucky-wheel.js", import.meta.url).href
    ).catch((e) => {
      wheelModP = null;
      throw e;
    });
  }
  return wheelModP;
}

/** GET /me/lucky-wheel, shared between the warm-up and the click (reused while fresh). */
function prefetchWheelState() {
  const uid = getAuthState()?.user?.id ?? null;
  if (!uid) return null;
  if (wheelPrefetch && wheelPrefetch.uid === uid && Date.now() - wheelPrefetch.at < WHEEL_STATE_FRESH_MS) return wheelPrefetch.promise;
  const entry = { at: Date.now(), uid, promise: api("/me/lucky-wheel") };
  entry.promise.catch(() => {
    if (wheelPrefetch === entry) wheelPrefetch = null;
  });
  wheelPrefetch = entry;
  return entry.promise;
}

function warmWheel() {
  const uid = getAuthState()?.user?.id ?? null;
  if (!wheelMode || !uid || wheelWarmed === uid) return;
  wheelWarmed = uid;
  const stateP = prefetchWheelState();
  loadWheelModule()
    .then(async (mod) => {
      mod.warmLuckyWheel?.(null);
      const r = await stateP;
      if (wheelWarmed === uid) mod.primeLuckyWheel?.(r?.data);
    })
    .catch(() => {
      if (wheelWarmed === uid) wheelWarmed = null; // try again on the next hover / paint
    });
}

function scheduleWheelWarm(btn) {
  if (!btn.dataset.lwWarmWired) {
    btn.dataset.lwWarmWired = "1";
    const now = () => {
      if (wheelMode) warmWheel();
    };
    btn.addEventListener("pointerenter", now, { passive: true });
    btn.addEventListener("pointerdown", now, { passive: true });
    btn.addEventListener("touchstart", now, { passive: true });
    btn.addEventListener("focus", now, { passive: true });
  }
  const uid = getAuthState()?.user?.id ?? null;
  if (!uid || wheelWarmed === uid || wheelWarmTimer) return;
  const run = () => {
    wheelWarmTimer = 0;
    warmWheel();
  };
  // after the entry has painted: next frame, then an idle slot (bounded so it still happens on a busy page)
  wheelWarmTimer = window.setTimeout(() => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, 120);
}

function setWheelMode(on, remaining) {
  wheelMode = !!on;
  wheelRemaining = on && Number.isFinite(Number(remaining)) ? Number(remaining) : null;
  writeWheelHint(wheelMode);
  paintWheelEntry(document.getElementById("jiuCoinDailyBtn"));
}

function onWheelChange(info) {
  if (!info) return;
  if (info.disabled) {
    setWheelMode(false);
    refreshJiuCoinStatus();
    return;
  }
  if (info.freeSpins && Number.isFinite(Number(info.freeSpins.total))) {
    wheelRemaining = Number(info.freeSpins.total);
    paintWheelEntry(document.getElementById("jiuCoinDailyBtn"));
  }
  const auth = getAuthState();
  if (auth.user && Number.isFinite(Number(info.balance))) {
    auth.user.jiuCoinBalance = info.balance;
    renderJiuCoinChrome();
  }
}

async function openWheelFromEntry() {
  if (wheelOpening) return;
  wheelOpening = true;
  try {
    // the state GET runs in parallel with the module import (both may already be warm)
    const prefetched = prefetchWheelState();
    const mod = await loadWheelModule();
    const r = await mod.openLuckyWheel({ onChange: onWheelChange, prefetched });
    wheelPrefetch = null; // spins change the state; the next open uses the module's own copy + a quiet refresh
    if (r && r.enabled === false) {
      // server says the wheel is off (flag flipped): fall back to the legacy daily claim flow
      setWheelMode(false);
      await refreshJiuCoinStatus();
      const btn = document.getElementById("jiuCoinDailyBtn");
      if (btn && !isAlreadyClaimedBtn(btn)) openDailyConfirmModal();
    }
  } catch (e) {
    showToast("转盘加载失败，请检查网络后重试", "error");
  } finally {
    wheelOpening = false;
  }
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function hydratePriceBadges() {
  document.querySelectorAll(".jiu-price-badge[data-jiu-price]").forEach((badge) => {
    const amount = badge.getAttribute("data-jiu-price");
    // Free pills: show 免费 text (not "0"+coin, which can read like "0/0").
    if (badge.classList.contains("jiu-price-free") || amount === "0") {
      badge.textContent = "免费";
      if (!badge.getAttribute("aria-label")) badge.setAttribute("aria-label", "免费");
      return;
    }
    badge.innerHTML = amountWithCoinHtml(amount, { size: 12 });
  });
}

function hydrateInlineCoinIcons() {
  document.querySelectorAll("[data-jiu-coin-icon]").forEach((node) => {
    const size = Number(node.getAttribute("data-size") || 14) || 14;
    const span = document.createElement("span");
    span.className = "jiu-coin-inline";
    span.innerHTML = coinIconHtml({ size });
    node.replaceWith(span);
  });
}

function ensureCoinDom() {
  const chip = document.getElementById("authChip");
  if (!chip) return null;
  let wrap = document.getElementById("jiuCoinChrome");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "jiuCoinChrome";
    wrap.className = "jiu-coin-chrome";
    wrap.hidden = true;
    wrap.innerHTML = `
      <span class="jiu-coin-balance" title="韭币余额" aria-live="polite">
        <span class="jiu-coin-amt">
          <span id="jiuCoinBalanceVal" class="jiu-price-num">0</span>
          ${coinIconHtml({ size: 12 })}
        </span>
      </span>
      <button type="button" class="jiu-coin-daily-btn" id="jiuCoinDailyBtn" title="每日领取韭币" aria-label="每日领取韭币"><span class="jiu-daily-full">每日领取</span><span class="jiu-daily-short">领取</span></button>
    `;
    const loginBtn = document.getElementById("authLoginBtn");
    if (loginBtn) chip.insertBefore(wrap, loginBtn);
    else chip.appendChild(wrap);

    const btn = document.getElementById("jiuCoinDailyBtn");
    if (btn) btn.addEventListener("click", onDailyClaimClick);
    paintWheelEntry(btn);
  }
  ensureModals();
  return wrap;
}

function ensureModals() {
  if (document.getElementById("jiuCoinDailyModal")) return;

  document.body.appendChild(
    el(`<div class="jiu-coin-modal" id="jiuCoinDailyModal" hidden>
      <div class="jiu-coin-dialog" role="dialog" aria-modal="true" aria-labelledby="jiuCoinDailyTitle">
        <button type="button" class="jiu-coin-close-x" id="jiuCoinDailyCloseX" aria-label="关闭">×</button>
        <h2 id="jiuCoinDailyTitle">每日领取</h2>
        <p class="jiu-coin-modal-body" id="jiuCoinDailyBody">
          每天 0 点（北京时间）刷新一次；本次额度随机，领取后立即到账。
        </p>
        <div class="jiu-coin-modal-actions">
          <button type="button" class="jiu-coin-secondary ctl ctl-secondary" id="jiuCoinDailyCancel" data-ctl-kind="secondary" data-state="default"><span class="ctl-label">取消</span></button>
          <button type="button" class="jiu-coin-primary ctl ctl-primary" id="jiuCoinDailyConfirm" data-ctl-kind="primary" data-state="default"><span class="ctl-label">领取</span></button>
        </div>
      </div>
    </div>`)
  );

  document.body.appendChild(
    el(`<div class="jiu-coin-modal" id="jiuCoinSuccessModal" hidden>
      <div class="jiu-coin-dialog jiu-coin-dialog--celebrate" role="dialog" aria-modal="true" aria-labelledby="jiuCoinSuccessTitle">
        <button type="button" class="jiu-coin-close-x" id="jiuCoinSuccessCloseX" aria-label="关闭">×</button>
        <h2 id="jiuCoinSuccessTitle">领取成功</h2>
        <p class="jiu-coin-modal-body jiu-coin-success-body" id="jiuCoinSuccessBody">
          恭喜你，获得奖励！
        </p>
        <div class="jiu-coin-modal-actions">
          <button type="button" class="jiu-coin-primary ctl ctl-primary" id="jiuCoinSuccessOk" data-ctl-kind="primary" data-state="default"><span class="ctl-label">好的</span></button>
        </div>
      </div>
    </div>`)
  );

  const bindClose = (modalId, ...btnIds) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const hide = () => {
      window.__stockControls?.closeCtlOverlay(modal) ?? (modal.hidden = true);
    };
    for (const id of btnIds) {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", hide);
    }
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hide();
    });
  };

  bindClose("jiuCoinDailyModal", "jiuCoinDailyCloseX", "jiuCoinDailyCancel");
  bindClose("jiuCoinSuccessModal", "jiuCoinSuccessCloseX", "jiuCoinSuccessOk");

  const confirmBtn = document.getElementById("jiuCoinDailyConfirm");
  if (confirmBtn) confirmBtn.addEventListener("click", onDailyClaimConfirm);
}

function openDailyConfirmModal() {
  ensureModals();
  const modal = document.getElementById("jiuCoinDailyModal");
  if (modal) window.__stockControls ? window.__stockControls.openCtlOverlay(modal) : (modal.hidden = false);
}

function closeDailyConfirmModal() {
  const modal = document.getElementById("jiuCoinDailyModal");
  if (modal) modal.hidden = true;
}

function openSuccessModal(amount) {
  ensureModals();
  const body = document.getElementById("jiuCoinSuccessBody");
  const n = Number(amount);
  const shown = Number.isFinite(n) ? String(n) : "—";
  if (body) {
    // 获得 85 [icon] — number then coin SVG
    body.innerHTML = `恭喜你，获得 <strong class="jiu-coin-amt jiu-coin-success-amt"><span class="jiu-price-num">${shown}</span>${coinIconHtml({ size: 16 })}</strong>！快去模拟盘大展身手吧！`;
  }
  const modal = document.getElementById("jiuCoinSuccessModal");
  if (modal) window.__stockControls ? window.__stockControls.openCtlOverlay(modal) : (modal.hidden = false);
}


function setDailyBtnLabel(btn, state) {
  if (!btn) return;
  const labels = {
    idle: { full: "每日领取", short: "领取" },
    claimed: { full: "今日已领", short: "已领" },
    busy: { full: "领取中…", short: "…" },
  };
  const L = labels[state] || labels.idle;
  let full = btn.querySelector(".jiu-daily-full");
  let short = btn.querySelector(".jiu-daily-short");
  if (!full || !short) {
    btn.textContent = "";
    full = document.createElement("span");
    full.className = "jiu-daily-full";
    short = document.createElement("span");
    short.className = "jiu-daily-short";
    btn.append(full, short);
  }
  full.textContent = L.full;
  short.textContent = L.short;
}

function isAlreadyClaimedBtn(btn) {
  if (!btn) return false;
  if (btn.classList.contains("is-claimed")) return true;
  const full = btn.querySelector(".jiu-daily-full");
  const t = (full ? full.textContent : btn.textContent) || "";
  return t.includes("今日已领") || t.includes("已领");
}

export function renderJiuCoinChrome() {
  ensureCoinDom();
  const wrap = document.getElementById("jiuCoinChrome");
  const balEl = document.getElementById("jiuCoinBalanceVal");
  const btn = document.getElementById("jiuCoinDailyBtn");
  if (!wrap || !balEl) return;

  const auth = getAuthState();
  const logged = selectIsAuthenticated(auth);
  wrap.hidden = !logged;
  if (!logged) {
    balEl.textContent = "0";
    if (btn && !wheelMode) {
      btn.disabled = false;
      setDailyBtnLabel(btn, "idle");
      btn.classList.remove("is-claimed");
    }
    return;
  }

  const bal = Number(auth.user.jiuCoinBalance);
  balEl.textContent = Number.isFinite(bal) ? String(bal) : "—";
}

export async function refreshJiuCoinStatus() {
  const auth = getAuthState();
  if (!auth.user) {
    renderJiuCoinChrome();
    return null;
  }
  try {
    const { data } = await api("/me/jiu-coin");
    if (auth.user) auth.user.jiuCoinBalance = data.balance;
    renderJiuCoinChrome();
    const btn = document.getElementById("jiuCoinDailyBtn");
    const wheel = data.wheel && data.wheel.enabled ? data.wheel : null;
    // `wheel` absent/disabled → legacy 每日领取 flow below (also restores the button after the flag is turned off)
    if (wheel || wheelMode) setWheelMode(!!wheel, wheel?.freeSpins?.total);
    if (btn && !wheel) {
      if (data.claimedToday) {
        btn.disabled = true;
        setDailyBtnLabel(btn, "claimed");
        btn.classList.add("is-claimed");
      } else {
        btn.disabled = false;
        setDailyBtnLabel(btn, "idle");
        btn.classList.remove("is-claimed");
      }
    }
    return data;
  } catch (e) {
    renderJiuCoinChrome();
    return null;
  }
}

function onDailyClaimClick() {
  if (claimBusy) return;
  const auth = getAuthState();
  if (!auth.user) return;
  if (wheelMode) {
    openWheelFromEntry();
    return;
  }
  const btn = document.getElementById("jiuCoinDailyBtn");
  if (isAlreadyClaimedBtn(btn)) return;
  openDailyConfirmModal();
}

async function onDailyClaimConfirm() {
  if (claimBusy) return;
  const auth = getAuthState();
  if (!auth.user) return;
  const btn = document.getElementById("jiuCoinDailyBtn");
  if (isAlreadyClaimedBtn(btn)) {
    closeDailyConfirmModal();
    return;
  }

  claimBusy = true;
  closeDailyConfirmModal();
  const confirmBtn = document.getElementById("jiuCoinDailyConfirm");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    (confirmBtn.querySelector(".ctl-label") || confirmBtn).textContent = "领取中…";
  }
  if (btn) {
    btn.disabled = true;
    setDailyBtnLabel(btn, "busy");
  }
  try {
    const { data } = await api("/me/jiu-coin/daily", { method: "POST" });
    if (auth.user) auth.user.jiuCoinBalance = data.balance;
    renderJiuCoinChrome();
    if (btn) {
      btn.disabled = true;
      setDailyBtnLabel(btn, "claimed");
      btn.classList.add("is-claimed");
    }
    openSuccessModal(data.amount);
  } catch (e) {
    if (e?.status === 410 || e?.code === "DAILY_REPLACED_BY_WHEEL") {
      // the server switched 每日领取 to the lucky wheel while this page was open
      showToast("每日领取已升级为幸运转盘", "info");
      await refreshJiuCoinStatus();
      return;
    }
    const msg = e?.message || "领取失败";
    showToast(msg, "error");
    if (e?.code === "ALREADY_CLAIMED_TODAY" || /已领取/.test(msg)) {
      if (btn) {
        btn.disabled = true;
        setDailyBtnLabel(btn, "claimed");
        btn.classList.add("is-claimed");
      }
    } else if (btn) {
      btn.disabled = false;
      setDailyBtnLabel(btn, "idle");
      btn.classList.remove("is-claimed");
    }
    await refreshJiuCoinStatus();
  } finally {
    claimBusy = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      (confirmBtn.querySelector(".ctl-label") || confirmBtn).textContent = "领取";
    }
  }
}

export function initJiuCoin() {
  installIconArtFallback();
  preloadIconArt();
  hydratePriceBadges();
  hydrateInlineCoinIcons();
  ensureCoinDom();
  renderJiuCoinChrome();
  document.addEventListener("stockgame:auth-changed", () => {
    refreshJiuCoinStatus();
  });
  // initAuth() has already settled by now (its auth-changed event fired before this listener existed), so ask once:
  // the server tells us whether the entry is the lucky wheel (`wheel`) or the legacy 每日领取 (and whether it was claimed).
  if (getAuthState().user) refreshJiuCoinStatus();
}
