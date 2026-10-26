/**
 * 邀请奖励 client: captures `?invite=CODE` from the URL, shows the invite sheet, reports the first-game payout.
 * Server flag: inviteRewardsEnabled (GET /me/invite → { enabled:false } hides every entry point).
 * The sheet reuses the announcements dialog shell (paper/ink frame, enter/leave anim, close-X art).
 */
import { api, getAuthState, selectIsAuthenticated, closeAuthModal } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay, showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import {
  parseInviteFromSearch, stripInviteFromUrl, writePendingInvite, buildInviteLink, statsLine, earnedLine,
  ruleLines, shareText, rewardToast,
} from "./invite-pure.js";

let state = null;
let inflight = null;
let fetchedAt = 0;
const $ = (id) => document.getElementById(id);
const authed = () => selectIsAuthenticated(getAuthState());

function store() {
  try { return window.localStorage; } catch { return null; }
}

/** Run once at boot: remember the code from the URL (guests register later) and clean the address bar. */
export function captureInviteFromUrl() {
  const code = parseInviteFromSearch(location.search);
  if (!code) return null;
  if (!authed()) writePendingInvite(store(), code);
  try {
    history.replaceState(history.state, "", stripInviteFromUrl(location.pathname, location.search, location.hash));
  } catch { /* ignore */ }
  return code;
}

/** GET /me/invite; null when logged out / flag off. Cached for 15s. */
export async function fetchInvite({ force = false } = {}) {
  if (!authed()) { state = null; return null; }
  if (!force && state && Date.now() - fetchedAt < 15000) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/invite");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    fetchedAt = Date.now();
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function inviteState() {
  return state;
}

function ensureModal() {
  if ($("inviteModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal invite-modal" id="inviteModal" hidden aria-hidden="true">
    <div class="announcements-dialog invite-dialog" role="dialog" aria-modal="true" aria-labelledby="inviteTitle">
      <button type="button" class="announcements-close-x" id="inviteCloseX" aria-label="关闭">×</button>
      <h2 id="inviteTitle">邀请好友</h2>
      <p class="invite-sub" id="inviteSub"></p>
      <div class="invite-code" id="inviteCode" aria-label="我的邀请码"></div>
      <ul class="invite-rules" id="inviteRules"></ul>
      <p class="invite-stats" id="inviteStats"></p>
      <p class="invite-stats invite-earned" id="inviteEarned"></p>
      <div class="announcements-actions invite-actions">
        <button type="button" class="announcements-secondary ctl ctl-secondary" id="inviteCopyCode" data-ctl-kind="secondary" data-state="default"><span class="ctl-label">复制邀请码</span></button>
        <button type="button" class="announcements-primary ctl ctl-primary" id="inviteShare" data-ctl-kind="primary" data-state="default"><span class="ctl-label">复制链接</span></button>
      </div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
}

function paint() {
  if (!state) return;
  $("inviteSub").textContent = "把邀请码发给朋友，一起玩，一起赚韭币";
  $("inviteCode").textContent = state.code;
  $("inviteRules").innerHTML = ruleLines(state).map((l) => `<li>${l}</li>`).join("");
  $("inviteStats").textContent = statsLine(state);
  $("inviteEarned").textContent = earnedLine(state);
  const shareBtn = $("inviteShare").querySelector(".ctl-label");
  shareBtn.textContent = typeof navigator !== "undefined" && navigator.share ? "发给好友" : "复制链接";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function onShare() {
  if (!state) return;
  const link = buildInviteLink(state.code, location.origin);
  const text = shareText(state.code, link);
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: "早知道当初不炒了", text, url: link });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const copied = await copyText(text);
  showStampToast(copied ? "邀请链接已复制" : "复制失败，请手动复制邀请码", copied ? "success" : "error");
}

async function onCopyCode() {
  if (!state) return;
  const copied = await copyText(state.code);
  showStampToast(copied ? "邀请码已复制" : "复制失败，请长按邀请码手动复制", copied ? "success" : "error");
}

export function closeInviteModal() {
  const m = $("inviteModal");
  if (m) closeCtlOverlay(m);
}

function wire() {
  const modal = $("inviteModal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  $("inviteCloseX").addEventListener("click", closeInviteModal);
  $("inviteShare").addEventListener("click", onShare);
  $("inviteCopyCode").addEventListener("click", onCopyCode);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeInviteModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeInviteModal(); });
}

export async function openInviteModal() {
  const s = await fetchInvite({ force: true });
  if (!s) {
    showStampToast("邀请功能暂未开放", "error");
    return;
  }
  // Opened from the 资料设置 panel: the auth modal (z 150) would sit on top of this sheet.
  const authModal = $("authModal");
  if (authModal && !authModal.hidden) closeAuthModal();
  ensureModal();
  wire();
  paint();
  openCtlOverlay($("inviteModal"));
}

/** Finish response carried `inviteReward` → toast + refresh coins. */
export function onInviteReward(reward) {
  const msg = rewardToast(reward);
  if (!msg) return;
  showStampToast(msg, "success");
  refreshJiuCoinStatus().catch(() => {});
}

/** Show/hide every static entry point (result-screen link, settings button) according to flag + login. */
export async function refreshInviteEntries() {
  const s = authed() ? await fetchInvite() : null;
  document.querySelectorAll("[data-invite-entry]").forEach((el) => { el.hidden = !s; });
  const coins = document.querySelectorAll("[data-invite-coins]");
  coins.forEach((el) => { el.textContent = s ? String(s.inviterCoins) : ""; });
  return s;
}

export function initInvite() {
  captureInviteFromUrl();
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-invite-open]") : null;
    if (t) { e.preventDefault(); openInviteModal().catch(() => {}); }
  });
  document.addEventListener("stockgame:auth-changed", () => {
    if (!authed()) { state = null; fetchedAt = 0; }
    refreshInviteEntries().catch(() => {});
  });
  refreshInviteEntries().catch(() => {});
}
