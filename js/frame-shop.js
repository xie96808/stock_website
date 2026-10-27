/**
 * 头像框 tab of the 韭菜商店 (js/leek-shop.js hosts it). Server flag: avatarFramesEnabled
 * (GET /me/frames → { enabled:false } hides the tab).
 * Spending 韭币 asks for a second tap ("确认 -N") so a stray touch on a phone never costs 2,000 coins.
 */
import { api, getAuthState, selectIsAuthenticated, displayAvatarUrl, applyAuthUser } from "./auth.js";
import { showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import { wrapAvatarHtml } from "./avatar-frame-pure.js";
import { actionForBalance, captionFor, sortFrames, buyToast, errorToast, tierOf } from "./frame-shop-pure.js";

let state = null;
let inflight = null;
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

/** Is the tab available (flag on, signed in)? */
export async function probeFrames() {
  return !!(await fetchFrames());
}

function cardHtml(f, avatarSrc, armedId) {
  const a = actionForBalance(f, state.balance, armedId === f.id);
  const img = `<img class="frame-avatar" src="${esc(avatarSrc)}" alt="" width="72" height="72">`;
  const tier = tierOf(f);
  return `<div class="frame-card frame-card--${tier}${f.equipped ? " is-equipped" : ""}${f.owned ? " is-owned" : ""}" data-id="${esc(f.id)}">
    ${tier === "prime" ? `<span class="frame-ribbon">镇店</span>` : tier === "fine" ? `<span class="frame-ribbon frame-ribbon--fine">精品</span>` : ""}
    <div class="frame-preview">${wrapAvatarHtml(img, f.id)}</div>
    <div class="frame-name">${esc(f.name)}</div>
    <div class="frame-cap">${esc(captionFor(f))}</div>
    <button type="button" class="frame-btn frame-btn--${a.kind}" data-frame-act="${esc(f.id)}" ${a.disabled ? "disabled" : ""}>${esc(a.label)}</button>
  </div>`;
}

/**
 * Mount the tab into `el`. hooks.balance(n) keeps the shop header in step with a purchase.
 * @returns {{ refresh: () => Promise<void> }}
 */
export function mountFramesPanel(el, hooks = {}) {
  let busy = false;
  let armedId = null;
  let armTimer = 0;
  const disarm = () => { armedId = null; window.clearTimeout(armTimer); };

  const paint = () => {
    if (!state) { el.innerHTML = ""; return; }
    hooks.balance?.(state.balance);
    const src = displayAvatarUrl(getAuthState().user);
    el.innerHTML = `<div class="frame-grid">${sortFrames(state.frames).map((f) => cardHtml(f, src, armedId)).join("")}</div>`;
  };

  const act = async (id) => {
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
  };

  el.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-frame-act]") : null;
    if (b) act(b.getAttribute("data-frame-act"));
  });

  return {
    async refresh() {
      disarm();
      await fetchFrames();
      paint();
    },
    leave: disarm,
  };
}

export function initFrameShop() {
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-frame-open]") : null;
    if (t) { e.preventDefault(); import("./leek-shop.js").then((m) => m.openLeekShop("frames")).catch(() => {}); }
  });
  document.addEventListener("stockgame:auth-changed", () => {
    if (!authed()) state = null;
  });
}
