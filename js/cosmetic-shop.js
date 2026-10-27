/**
 * 对战装扮商店 client. Server flag: pvpCosmeticsEnabled (GET /me/cosmetics → { enabled:false } hides every entry).
 * Sticker packs + entrance effects, bought with 韭币 (two taps: "购买 N" arms "确认 -N"). The sheet reuses the
 * announcements dialog shell. Reached from the PvP lobby and from the in-match sticker tray.
 */
import { api, getAuthState, selectIsAuthenticated, closeAuthModal, applyAuthUser } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay, showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import { stickerSvg } from "./sticker-art-pure.js";
import { playEntranceFx } from "./entrance-fx.js";
import { actionForBalance, cosBuyToast, errorToast, entranceCaption, packCaption } from "./cosmetic-pure.js";

let state = null;
let fetchedAt = 0;
let busy = false;
let armedId = null;
let armTimer = 0;
let inflight = null;
const listeners = new Set();
const $ = (id) => document.getElementById(id);
const authed = () => selectIsAuthenticated(getAuthState());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function cosmeticsState() {
  return state;
}

/** Subscribe to state changes (purchase / equip / refetch). Returns an unsubscribe fn. */
export function onCosmeticsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(next) {
  state = next;
  fetchedAt = Date.now();
  for (const fn of listeners) { try { fn(state); } catch { /* listener errors never break the shop */ } }
}

export async function fetchCosmetics({ force = false } = {}) {
  if (!authed()) { setState(null); return null; }
  if (!force && state && Date.now() - fetchedAt < 20000) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/cosmetics");
      setState(data && data.enabled ? data : null);
    } catch {
      setState(null);
    }
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

function ensureModal() {
  if ($("cosModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal cos-modal" id="cosModal" hidden aria-hidden="true">
    <div class="announcements-dialog cos-dialog" role="dialog" aria-modal="true" aria-labelledby="cosTitle">
      <button type="button" class="announcements-close-x" id="cosCloseX" aria-label="关闭">×</button>
      <h2 id="cosTitle">对战装扮</h2>
      <p class="cos-sub" id="cosSub"></p>
      <div class="cos-body" id="cosBody"></div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
}

function btnHtml(item) {
  const a = actionForBalance(item, state.balance, armedId === item.id);
  return `<button type="button" class="cos-btn cos-btn--${a.kind}" data-cos-act="${esc(item.id)}" ${a.disabled ? "disabled" : ""}>${esc(a.label)}</button>`;
}

function packHtml(p) {
  const minis = (p.stickers || []).map((id) => `<span class="cos-mini">${stickerSvg(id)}</span>`).join("");
  return `<div class="cos-card cos-card--pack${p.owned ? " is-owned" : ""}" data-id="${esc(p.id)}">
    <div class="cos-pack-head"><strong class="cos-name">${esc(p.name)}</strong><span class="cos-cap">${esc(packCaption(p))}</span></div>
    <div class="cos-minis">${minis}</div>
    ${btnHtml(p)}
  </div>`;
}

function entranceHtml(e) {
  return `<div class="cos-card cos-card--fx${e.equipped ? " is-equipped" : ""}${e.owned ? " is-owned" : ""}" data-id="${esc(e.id)}">
    <div class="cos-stage" data-cos-stage="${esc(e.id)}"><span class="cos-stage-dot"></span></div>
    <strong class="cos-name">${esc(e.name)}</strong>
    <span class="cos-cap">${esc(entranceCaption(e))}</span>
    <button type="button" class="cos-try" data-cos-try="${esc(e.id)}">试看</button>
    ${btnHtml(e)}
  </div>`;
}

function paint() {
  if (!state || !$("cosBody")) return;
  $("cosSub").textContent = `我的韭币 ${state.balance}`;
  $("cosBody").innerHTML =
    `<h3 class="cos-h">表情包<small>对战中发给对手</small></h3>${state.packs.map(packHtml).join("")}` +
    `<h3 class="cos-h">出场特效<small>开局时在你的座位上播放，双方都看得到</small></h3><div class="cos-grid">${state.entrances.map(entranceHtml).join("")}</div>`;
}

function disarm() {
  armedId = null;
  window.clearTimeout(armTimer);
}

async function act(id) {
  if (busy || !state) return;
  const item = [...state.packs, ...state.entrances].find((x) => x.id === id);
  if (!item) return;
  const a = actionForBalance(item, state.balance, armedId === id);
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
      ({ data } = await api(`/me/cosmetics/${encodeURIComponent(id)}/buy`, { method: "POST", body: {} }));
      showStampToast(cosBuyToast(item), "success");
      refreshJiuCoinStatus().catch(() => {});
    } else {
      ({ data } = await api("/me/cosmetics/equip-entrance", { method: "POST", body: { id: a.kind === "equip" ? id : null } }));
      if (data.user) applyAuthUser(data.user);
    }
    setState({ ...data.state, enabled: true });
  } catch (e) {
    showStampToast(errorToast(e), "error");
    await fetchCosmetics({ force: true });
  } finally {
    busy = false;
    paint();
  }
}

export function closeCosmeticShop() {
  disarm();
  const m = $("cosModal");
  if (m) closeCtlOverlay(m);
}

function wire() {
  const modal = $("cosModal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  $("cosCloseX").addEventListener("click", closeCosmeticShop);
  $("cosBody").addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    const tryBtn = t && t.closest("[data-cos-try]");
    if (tryBtn) {
      const id = tryBtn.getAttribute("data-cos-try");
      const stage = $("cosBody").querySelector(`[data-cos-stage="${id}"] .cos-stage-dot`);
      playEntranceFx(id, stage).catch(() => {});
      return;
    }
    const b = t && t.closest("[data-cos-act]");
    if (b) act(b.getAttribute("data-cos-act"));
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeCosmeticShop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeCosmeticShop(); });
}

export async function openCosmeticShop() {
  const s = await fetchCosmetics({ force: true });
  if (!s) {
    showStampToast("对战装扮暂未开放", "error");
    return;
  }
  const authModal = $("authModal");
  if (authModal && !authModal.hidden) closeAuthModal();
  ensureModal();
  wire();
  disarm();
  paint();
  openCtlOverlay($("cosModal"));
}

/** Show / hide the static entry points from flag + login. */
export async function refreshCosmeticEntries() {
  const s = authed() ? await fetchCosmetics() : null;
  document.querySelectorAll("[data-cosmetic-entry]").forEach((el) => { el.hidden = !s; });
  return s;
}

export function initCosmeticShop() {
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-cosmetic-open]") : null;
    if (t) { e.preventDefault(); openCosmeticShop().catch(() => {}); }
  });
  document.addEventListener("stockgame:auth-changed", () => {
    if (!authed()) setState(null);
    refreshCosmeticEntries().catch(() => {});
  });
  refreshCosmeticEntries().catch(() => {});
}
