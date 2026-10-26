/**
 * 连续登录奖励 client: a small pill on the home screen + a sheet with the 7-day cycle.
 * Server flag: loginStreakEnabled (GET /me/streak → { enabled:false } hides everything).
 * The sheet reuses the announcements dialog shell (paper/ink frame, enter/leave anim, close-X art).
 */
import { api, getAuthState, selectIsAuthenticated } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay, showStampToast } from "./controls.js";
import { coinIconHtml, refreshJiuCoinStatus } from "./jiu-coin.js";
import { chipModels, claimLabel, subText, noteText, pillModel, claimToast, shouldAutoOpen } from "./login-streak-pure.js";

const SEEN_KEY = "stockgame.streak.autoshown";
let state = null;
let busy = false;
let wired = false;

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ""; } catch { return ""; }
}
function writeSeen(ymd) {
  try { localStorage.setItem(SEEN_KEY, ymd); } catch { /* private mode */ }
}
const authed = () => selectIsAuthenticated(getAuthState());
const $ = (id) => document.getElementById(id);

function ensureModal() {
  if ($("streakModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal streak-modal" id="streakModal" hidden aria-hidden="true">
    <div class="announcements-dialog streak-dialog" role="dialog" aria-modal="true" aria-labelledby="streakTitle">
      <button type="button" class="announcements-close-x" id="streakCloseX" aria-label="关闭">×</button>
      <h2 id="streakTitle">连续登录奖励</h2>
      <p class="streak-sub" id="streakSub"></p>
      <div class="streak-days" id="streakDays"></div>
      <p class="streak-note" id="streakNote"></p>
      <div class="announcements-actions streak-actions">
        <button type="button" class="announcements-primary ctl ctl-primary" id="streakClaim" data-ctl-kind="primary" data-state="default"><span class="ctl-label">领取</span></button>
      </div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
}

function paintModal() {
  if (!state?.enabled) return;
  $("streakSub").textContent = subText(state);
  $("streakNote").textContent = noteText(state);
  $("streakDays").innerHTML = chipModels(state)
    .map((c) => {
      const extra = c.spins > 0 ? `<span class="sd-extra">转盘 +${c.spins}</span>` : "";
      const mark = c.status === "done" ? `<i class="sd-check" aria-hidden="true">✓</i>` : "";
      return `<div class="streak-day is-${c.status}${c.day === 7 ? " is-last" : ""}" data-day="${c.day}">
        <span class="sd-n">第${c.day}天</span>
        <span class="sd-v">+${c.coins}${coinIconHtml({ size: 14 })}</span>
        ${extra}${mark}
      </div>`;
    })
    .join("");
  const btn = $("streakClaim");
  btn.disabled = !!state.claimedToday || busy;
  btn.querySelector(".ctl-label").textContent = busy ? "领取中…" : claimLabel(state);
}

function paintPill() {
  const pill = $("homeStreak");
  if (!pill) return;
  const m = authed() && state ? pillModel(state) : null;
  pill.hidden = !m;
  pill.classList.toggle("is-on", !!m);
  if (!m) return;
  pill.classList.toggle("is-claimable", m.claimable);
  pill.querySelector(".hs-txt").textContent = m.text;
  pill.querySelector("button").textContent = m.button;
}

let inflight = null;
let fetchedAt = 0;

/** `stockgame:auth-changed` fires on every chrome repaint: reuse a state fetched in the last 15s. */
export async function refreshStreak({ force = false } = {}) {
  if (!authed()) {
    state = null;
    paintPill();
    return null;
  }
  if (!force && state && Date.now() - fetchedAt < 15000) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/streak");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    fetchedAt = Date.now();
    paintPill();
    if ($("streakModal") && !$("streakModal").hidden) paintModal();
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function closeStreakModal() {
  const m = $("streakModal");
  if (m) closeCtlOverlay(m);
}

export async function openStreakModal() {
  if (!state) await refreshStreak();
  if (!state) return;
  ensureModal();
  wire();
  paintModal();
  openCtlOverlay($("streakModal"));
}

async function claim() {
  if (busy || !state || state.claimedToday) return;
  busy = true;
  paintModal();
  try {
    const { data } = await api("/me/streak/claim", { method: "POST", body: {} });
    state = data.state;
    fetchedAt = Date.now();
    showStampToast(claimToast(data.claimed), "success");
    refreshJiuCoinStatus().catch(() => {});
  } catch (e) {
    if (e && e.status === 409) {
      await refreshStreak({ force: true }); // another tab already claimed today
    } else if (e && e.status === 404) {
      state = null;
      closeStreakModal();
    } else {
      showStampToast("领取失败，请稍后再试", "error");
    }
  } finally {
    busy = false;
    paintPill();
    paintModal();
  }
}

function wire() {
  const modal = $("streakModal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  $("streakCloseX").addEventListener("click", closeStreakModal);
  $("streakClaim").addEventListener("click", claim);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeStreakModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeStreakModal(); });
}

/** Wait until the announcement popup (if open) is gone, then run fn. */
function afterAnnouncements(fn) {
  const a = $("announcementsModal");
  if (!a || a.hidden) return fn();
  const obs = new MutationObserver(() => {
    if (a.hidden) { obs.disconnect(); window.setTimeout(fn, 250); }
  });
  obs.observe(a, { attributes: true, attributeFilter: ["hidden"] });
}

function homeVisible() {
  const s = $("startScreen");
  return !!(s && s.offsetParent !== null && !/^#\/pvp\/./.test(location.hash));
}

async function maybeAutoOpen() {
  const s = await refreshStreak();
  if (!s || !shouldAutoOpen(s, readSeen())) return;
  afterAnnouncements(() => {
    if (!state || state.claimedToday || !homeVisible()) return;
    writeSeen(state.today);
    openStreakModal().catch(() => {});
  });
}

export function initLoginStreak() {
  const pill = $("homeStreak");
  if (pill && !pill.dataset.wired) {
    pill.dataset.wired = "1";
    pill.querySelector("button").addEventListener("click", () => { openStreakModal().catch(() => {}); });
  }
  if (!wired) {
    wired = true;
    document.addEventListener("stockgame:auth-changed", (e) => {
      if (e.detail && e.detail.ready && selectIsAuthenticated({ status: e.detail.status, user: e.detail.user, ready: e.detail.ready })) maybeAutoOpen();
      else { state = null; fetchedAt = 0; paintPill(); }
    });
  }
  if (authed()) maybeAutoOpen();
}
