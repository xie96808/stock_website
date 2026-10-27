/**
 * 成就 client: a small pill on the home screen + a sheet listing every achievement with progress and 领取.
 * Server flag: achievementsEnabled (GET /me/achievements → { enabled:false } hides everything).
 * The sheet reuses the announcements dialog shell (paper/ink frame, enter/leave anim, close-X art).
 */
import { api, getAuthState, selectIsAuthenticated } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay, showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import {
  sections, progressPct, progressLabel, rewardLabel, pillModel, claimAllLabel, subText, claimToast,
} from "./achievements-pure.js";

let state = null;
let inflight = null;
let fetchedAt = 0;
let busy = false;
let wired = false;
/** Group ids the player has opened. Everything starts folded (the list is long on a phone); survives repaints. */
const openGroups = new Set();
const $ = (id) => document.getElementById(id);
const authed = () => selectIsAuthenticated(getAuthState());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function achievementsState() {
  return state;
}

function ensureModal() {
  if ($("achModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal ach-modal" id="achModal" hidden aria-hidden="true">
    <div class="announcements-dialog ach-dialog" role="dialog" aria-modal="true" aria-labelledby="achTitle">
      <button type="button" class="announcements-close-x" id="achCloseX" aria-label="关闭">×</button>
      <h2 id="achTitle">成就</h2>
      <p class="ach-sub" id="achSub"></p>
      <div class="ach-list" id="achList"></div>
      <div class="announcements-actions ach-actions">
        <button type="button" class="announcements-primary ctl ctl-primary" id="achClaimAll" data-ctl-kind="primary" data-state="default"><span class="ctl-label">全部领取</span></button>
      </div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
}

function itemHtml(it) {
  const pct = progressPct(it);
  const action = it.claimable
    ? `<button type="button" class="ach-claim" data-ach-claim="${esc(it.key)}">领取</button>`
    : it.claimed
      ? `<span class="ach-done" aria-label="已领取">✓</span>`
      : `<span class="ach-prog">${esc(progressLabel(it))}</span>`;
  return `<div class="ach-item${it.claimable ? " is-claimable" : ""}${it.claimed ? " is-claimed" : ""}" data-key="${esc(it.key)}">
    <div class="ach-main">
      <div class="ach-name">${esc(it.name)}<span class="ach-reward">${esc(rewardLabel(it))}</span></div>
      <div class="ach-desc">${esc(it.desc)}</div>
      ${it.claimed ? "" : `<div class="ach-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>`}
    </div>
    <div class="ach-side">${action}</div>
  </div>`;
}

function groupHtml(s) {
  const open = openGroups.has(s.id);
  const badge = s.claimable > 0 ? `<em class="ach-group-badge">${s.claimable} 可领取</em>` : "";
  return `<section class="ach-group${open ? " is-expanded" : ""}" data-group="${esc(s.id)}">
    <button type="button" class="ach-group-head" data-ach-group="${esc(s.id)}" aria-expanded="${open}" aria-controls="achg-${esc(s.id)}">
      <span class="ach-group-name">${esc(s.name)}</span>
      <small>${s.claimed}/${s.total}</small>
      ${badge}
      <i class="ach-chev" aria-hidden="true"></i>
    </button>
    <div class="ach-group-body" id="achg-${esc(s.id)}"${open ? "" : " hidden"}>${s.items.map(itemHtml).join("")}</div>
  </section>`;
}

function paintModal() {
  if (!state?.enabled) return;
  $("achSub").textContent = subText(state);
  $("achList").innerHTML = sections(state).map(groupHtml).join("");
  const btn = $("achClaimAll");
  const can = state.summary.claimable > 0;
  btn.disabled = !can || busy;
  btn.querySelector(".ctl-label").textContent = busy ? "领取中…" : claimAllLabel(state);
}

function paintPill() {
  const pill = $("homeAch");
  if (!pill) return;
  const m = authed() && state ? pillModel(state) : null;
  pill.hidden = !m;
  pill.classList.toggle("is-on", !!m);
  if (!m) return;
  pill.classList.toggle("is-claimable", m.claimable);
  pill.querySelector(".ha-pill-txt").textContent = m.text;
}

/** GET /me/achievements; `stockgame:auth-changed` fires on every chrome repaint, so reuse a fetch from the last 15s. */
export async function refreshAchievements({ force = false } = {}) {
  if (!authed()) {
    state = null;
    paintPill();
    return null;
  }
  if (!force && state && Date.now() - fetchedAt < 15000) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/achievements");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    fetchedAt = Date.now();
    paintPill();
    if ($("achModal") && !$("achModal").hidden) paintModal();
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function closeAchievementsModal() {
  const m = $("achModal");
  if (m) closeCtlOverlay(m);
}

export async function openAchievementsModal() {
  await refreshAchievements({ force: true });
  if (!state) return;
  ensureModal();
  wire();
  paintModal();
  openCtlOverlay($("achModal"));
}

async function doClaim(key) {
  if (busy || !state) return;
  busy = true;
  paintModal();
  try {
    const path = key ? `/me/achievements/${encodeURIComponent(key)}/claim` : "/me/achievements/claim-all";
    const { data } = await api(path, { method: "POST", body: {} });
    state = data.state;
    fetchedAt = Date.now();
    const msg = claimToast(data);
    if (msg) showStampToast(msg, "success");
    refreshJiuCoinStatus().catch(() => {});
  } catch (e) {
    if (e && e.status === 409) await refreshAchievements({ force: true });
    else if (e && e.status === 404) { state = null; closeAchievementsModal(); }
    else showStampToast("领取失败，请稍后再试", "error");
  } finally {
    busy = false;
    paintPill();
    paintModal();
  }
}

function wire() {
  const modal = $("achModal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  $("achCloseX").addEventListener("click", closeAchievementsModal);
  $("achClaimAll").addEventListener("click", () => doClaim(null));
  $("achList").addEventListener("click", (e) => {
    const t = e.target.closest ? e.target : null;
    const head = t && t.closest("[data-ach-group]");
    if (head) {
      const id = head.getAttribute("data-ach-group");
      const open = !openGroups.has(id);
      if (open) openGroups.add(id);
      else openGroups.delete(id);
      const sec = head.closest(".ach-group");
      sec.classList.toggle("is-expanded", open);
      head.setAttribute("aria-expanded", String(open));
      sec.querySelector(".ach-group-body").hidden = !open;
      return;
    }
    const b = t && t.closest("[data-ach-claim]");
    if (b) doClaim(b.getAttribute("data-ach-claim"));
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeAchievementsModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeAchievementsModal(); });
}

export function initAchievements() {
  const pill = $("homeAch");
  if (pill && !pill.dataset.wired) {
    pill.dataset.wired = "1";
    pill.addEventListener("click", () => { openAchievementsModal().catch(() => {}); });
  }
  if (!wired) {
    wired = true;
    document.addEventListener("stockgame:auth-changed", () => {
      if (authed()) refreshAchievements().catch(() => {});
      else { state = null; fetchedAt = 0; paintPill(); }
    });
  }
  if (authed()) refreshAchievements().catch(() => {});
}
