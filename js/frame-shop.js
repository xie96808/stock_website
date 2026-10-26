/**
 * 头像框商店 client. Server flag: avatarFramesEnabled (GET /me/frames → { enabled:false } hides every entry).
 * Reached from 资料设置 → 头像框. The sheet reuses the announcements dialog shell.
 * Spending 韭币 asks for a second tap ("确认 -N") so a stray touch on a phone never costs 1,500 coins.
 */
import { api, getAuthState, selectIsAuthenticated, displayAvatarUrl, closeAuthModal, applyAuthUser } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay, showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import { wrapAvatarHtml } from "./avatar-frame-pure.js";
import { actionForBalance, captionFor, sortFrames, buyToast, errorToast } from "./frame-shop-pure.js";

let state = null;
let busy = false;
let armedId = null;
let armTimer = 0;
let inflight = null;
const $ = (id) => document.getElementById(id);
const authed = () => selectIsAuthenticated(getAuthState());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function fetchFrames() {
  if (!authed()) { state = null; return null; }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/frames");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

function ensureModal() {
  if ($("frameModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal frame-modal" id="frameModal" hidden aria-hidden="true">
    <div class="announcements-dialog frame-dialog" role="dialog" aria-modal="true" aria-labelledby="frameTitle">
      <button type="button" class="announcements-close-x" id="frameCloseX" aria-label="关闭">×</button>
      <h2 id="frameTitle">头像框</h2>
      <p class="frame-sub" id="frameSub"></p>
      <div class="frame-grid" id="frameGrid"></div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
}

function cardHtml(f, avatarSrc) {
  const a = actionForBalance(f, state.balance, armedId === f.id);
  const img = `<img class="frame-avatar" src="${esc(avatarSrc)}" alt="" width="56" height="56">`;
  return `<div class="frame-card${f.equipped ? " is-equipped" : ""}${f.owned ? " is-owned" : ""}" data-id="${esc(f.id)}">
    <div class="frame-preview">${wrapAvatarHtml(img, f.id)}</div>
    <div class="frame-name">${esc(f.name)}</div>
    <div class="frame-cap">${esc(captionFor(f))}</div>
    <button type="button" class="frame-btn frame-btn--${a.kind}" data-frame-act="${esc(f.id)}" ${a.disabled ? "disabled" : ""}>${esc(a.label)}</button>
  </div>`;
}

function paint() {
  if (!state) return;
  const src = displayAvatarUrl(getAuthState().user);
  $("frameSub").textContent = `我的韭币 ${state.balance}`;
  $("frameGrid").innerHTML = sortFrames(state.frames).map((f) => cardHtml(f, src)).join("");
}

function disarm() {
  armedId = null;
  window.clearTimeout(armTimer);
}

async function act(id) {
  if (busy || !state) return;
  const f = state.frames.find((x) => x.id === id);
  if (!f) return;
  const a = actionForBalance(f, state.balance, armedId === id);
  if (a.disabled) return;
  if (a.kind === "buy") {
    armedId = id;
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => { armedId = null; paint(); }, 3500);
    paint();
    return;
  }
  disarm();
  busy = true;
  try {
    let data;
    if (a.kind === "confirm") {
      ({ data } = await api(`/me/frames/${encodeURIComponent(id)}/buy`, { method: "POST", body: {} }));
      showStampToast(buyToast(f.name, f.price), "success");
      refreshJiuCoinStatus().catch(() => {});
    } else {
      ({ data } = await api("/me/frames/equip", { method: "POST", body: { frameId: a.kind === "equip" ? id : null } }));
      if (data.user) applyAuthUser(data.user);
      import("./leaderboard.js").then((m) => m.invalidateLeaderboardClientCache?.()).catch(() => {});
    }
    state = { ...data.state, enabled: true };
  } catch (e) {
    showStampToast(errorToast(e), "error");
    await fetchFrames();
  } finally {
    busy = false;
    paint();
  }
}

export function closeFrameShop() {
  disarm();
  const m = $("frameModal");
  if (m) closeCtlOverlay(m);
}

function wire() {
  const modal = $("frameModal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  $("frameCloseX").addEventListener("click", closeFrameShop);
  $("frameGrid").addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-frame-act]") : null;
    if (b) act(b.getAttribute("data-frame-act"));
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeFrameShop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeFrameShop(); });
}

export async function openFrameShop() {
  const s = await fetchFrames();
  if (!s) {
    showStampToast("头像框暂未开放", "error");
    return;
  }
  const authModal = $("authModal");
  if (authModal && !authModal.hidden) closeAuthModal();
  ensureModal();
  wire();
  disarm();
  paint();
  openCtlOverlay($("frameModal"));
}

/** Show / hide the static entry points (资料设置 button) from flag + login. */
export async function refreshFrameEntries() {
  const s = authed() ? await fetchFrames() : null;
  document.querySelectorAll("[data-frame-entry]").forEach((el) => { el.hidden = !s; });
  return s;
}

export function initFrameShop() {
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-frame-open]") : null;
    if (t) { e.preventDefault(); openFrameShop().catch(() => {}); }
  });
  document.addEventListener("stockgame:auth-changed", () => {
    if (!authed()) state = null;
    refreshFrameEntries().catch(() => {});
  });
  refreshFrameEntries().catch(() => {});
}
