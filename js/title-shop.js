/**
 * 称号 tab of the 韭菜商店 (js/leek-shop.js hosts it). Server flag: titleShopEnabled
 * (GET /me/titles → { enabled:false } hides the tab). Two taps to spend ("购买 N" → "确认 -N").
 */
import { api, getAuthState, selectIsAuthenticated, applyAuthUser } from "./auth.js";
import { showStampToast } from "./controls.js";
import { refreshJiuCoinStatus } from "./jiu-coin.js";
import { actionForBalance } from "./frame-shop-pure.js";
import { titleChipHtml } from "./title-pure.js";

let state = null;
let inflight = null;
const authed = () => selectIsAuthenticated(getAuthState());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function fetchTitles() {
  if (!authed()) { state = null; return null; }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api("/me/titles");
      state = data && data.enabled ? data : null;
    } catch {
      state = null;
    }
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function probeTitles() {
  return !!(await fetchTitles());
}

function caption(t) {
  if (t.equipped) return "佩戴中";
  if (t.owned) return "已拥有";
  return t.desc || "";
}

function cardHtml(t, armedId) {
  const a = actionForBalance(t, state.balance, armedId === t.id);
  return `<div class="title-card title-card--${esc(t.tier)}${t.equipped ? " is-equipped" : ""}${t.owned ? " is-owned" : ""}" data-id="${esc(t.id)}">
    <div class="title-preview">${titleChipHtml(t.id, { size: "lg" })}</div>
    <div class="title-cap">${esc(caption(t))}</div>
    <button type="button" class="frame-btn frame-btn--${a.kind}" data-title-act="${esc(t.id)}" ${a.disabled ? "disabled" : ""}>${esc(a.label)}</button>
  </div>`;
}

export function mountTitlesPanel(el, hooks = {}) {
  let busy = false;
  let armedId = null;
  let armTimer = 0;
  const disarm = () => { armedId = null; window.clearTimeout(armTimer); };

  const paint = () => {
    if (!state) { el.innerHTML = ""; return; }
    hooks.balance?.(state.balance);
    el.innerHTML =
      `<p class="leek-note">称号会显示在昵称旁：排行榜、韭币榜、对战大厅和对局里都看得到。一次只能佩戴一个。</p>` +
      `<div class="title-grid">${state.titles.map((t) => cardHtml(t, armedId)).join("")}</div>`;
  };

  const act = async (id) => {
    if (busy || !state) return;
    const t = state.titles.find((x) => x.id === id);
    if (!t) return;
    const a = actionForBalance(t, state.balance, armedId === id);
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
        ({ data } = await api(`/me/titles/${encodeURIComponent(id)}/buy`, { method: "POST", body: {} }));
        showStampToast(`已购买称号「${t.name}」-${t.price} 韭币，点「装备」佩戴`, "success");
        refreshJiuCoinStatus().catch(() => {});
      } else {
        ({ data } = await api("/me/titles/equip", { method: "POST", body: { titleId: a.kind === "equip" ? id : null } }));
        if (data.user) applyAuthUser(data.user);
        import("./leaderboard.js").then((m) => m.invalidateLeaderboardClientCache?.()).catch(() => {});
      }
      state = { ...data.state, enabled: true };
    } catch (e) {
      const code = e && e.code;
      showStampToast(code === "INSUFFICIENT_FUNDS" ? "韭币不足" : code === "ALREADY_OWNED" ? "你已经拥有这个称号了" : "操作失败，请稍后再试", "error");
      await fetchTitles();
    } finally {
      busy = false;
      paint();
    }
  };

  el.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-title-act]") : null;
    if (b) act(b.getAttribute("data-title-act"));
  });

  return {
    async refresh() {
      disarm();
      await fetchTitles();
      paint();
    },
    leave: disarm,
  };
}
