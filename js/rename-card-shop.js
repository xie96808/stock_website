/**
 * 改名卡 tab of the 韭菜商店 (js/leek-shop.js hosts it). Server flag: renameCardEnabled
 * (GET /me/rename-card → { enabled:false } hides the tab; nicknames then change for free as before).
 */
import { api, getAuthState, selectIsAuthenticated, applyAuthUser } from "./auth.js";
import { showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";

let state = null;
let inflight = null;
const authed = () => selectIsAuthenticated(getAuthState());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function fetchRename() {
  if (!authed()) { state = null; return null; }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/rename-card");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function probeRename() {
  return !!(await fetchRename());
}

export function mountRenamePanel(el, hooks = {}) {
  let busy = false;
  let armed = false;
  let armTimer = 0;
  const disarm = () => { armed = false; window.clearTimeout(armTimer); };

  const paint = () => {
    if (!state) { el.innerHTML = ""; return; }
    hooks.balance?.(state.balance);
    const poor = state.balance < state.price;
    const label = poor ? `还差 ${state.price - state.balance}` : armed ? `确认 -${state.price}` : `购买 ${state.price}`;
    const kind = poor ? "poor" : armed ? "confirm" : "buy";
    el.innerHTML = `<div class="rename-card">
      <div class="rename-ticket" aria-hidden="true"><span>改名卡</span><small>NAME CARD</small></div>
      <p class="rename-have">我的改名卡 <strong>${Number(state.cards)}</strong> 张</p>
      <p class="rename-now">当前昵称：${esc(state.nickname)}</p>
      <button type="button" class="frame-btn frame-btn--${kind}" data-rename-buy ${poor ? "disabled" : ""}>${esc(label)}</button>
      <ul class="rename-rules">
        <li>改一次昵称消耗 1 张改名卡；保存同样的昵称、改头像和签名都不用卡。</li>
        <li>买好后：点右上角头像 → 修改昵称 → 保存。</li>
        <li>每次改名都会留下记录，请勿冒用他人昵称。</li>
      </ul>
    </div>`;
  };

  el.addEventListener("click", async (e) => {
    const b = e.target.closest ? e.target.closest("[data-rename-buy]") : null;
    if (!b || busy || !state) return;
    if (state.balance < state.price) return;
    if (!armed) {
      armed = true;
      window.clearTimeout(armTimer);
      armTimer = window.setTimeout(() => { armed = false; paint(); }, 3500);
      paint();
      return;
    }
    disarm();
    busy = true;
    try {
      const { data } = await api("/me/rename-card/buy", { method: "POST", body: {} });
      if (data.user) applyAuthUser(data.user);
      state = { ...data.state, enabled: true };
      showStampToast(`已购买改名卡 -${data.state.price} 韭币`, "success");
      refreshJiuCoinStatus().catch(() => {});
    } catch (err) {
      showStampToast(err && err.code === "INSUFFICIENT_FUNDS" ? "韭币不足" : "操作失败，请稍后再试", "error");
      await fetchRename();
    } finally {
      busy = false;
      paint();
    }
  });

  return {
    async refresh() {
      disarm();
      await fetchRename();
      paint();
    },
    leave: disarm,
  };
}
