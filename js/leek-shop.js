/**
 * 韭菜商店 — one place to spend 韭币. Opened from the 「商店」 button in the top bar (between 公告 and the 韭币 balance).
 * Tabs: 头像框 · 对战装扮 · 称号 · 改名卡. Each tab is its own module with the same small contract:
 *   probe()                    → Promise<boolean>   is it available (server flag on, signed in)?
 *   mount(el, { balance })     → { refresh(), leave() }
 * A tab whose probe fails is simply not shown, so a server with a flag off never shows a dead tab. The sheet reuses the
 * announcements dialog shell, like every other sheet in the app.
 */
import { getAuthState, selectIsAuthenticated } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay } from "./controls.js";

const TABS = [
  { id: "frames", label: "头像框", load: () => import("./frame-shop.js").then((m) => ({ probe: m.probeFrames, mount: m.mountFramesPanel })) },
  { id: "cos", label: "对战装扮", load: () => import("./cosmetic-shop.js").then((m) => ({ probe: m.probeCosmetics, mount: m.mountCosmeticsPanel })) },
  { id: "titles", label: "称号", load: () => import("./title-shop.js").then((m) => ({ probe: m.probeTitles, mount: m.mountTitlesPanel })) },
  { id: "rename", label: "改名卡", load: () => import("./rename-card-shop.js").then((m) => ({ probe: m.probeRename, mount: m.mountRenamePanel })) },
];

const $ = (id) => document.getElementById(id);
const authed = () => selectIsAuthenticated(getAuthState());
let available = null; // [{ ...tab, api, panel, mounted }] for the tabs that probed true
let current = null;
let opening = null;

function ensureModal() {
  if ($("leekShopModal")) return;
  const t = document.createElement("template");
  t.innerHTML = `<div class="announcements-modal leek-shop-modal" id="leekShopModal" hidden aria-hidden="true">
    <div class="announcements-dialog leek-shop-dialog" role="dialog" aria-modal="true" aria-labelledby="leekShopTitle">
      <button type="button" class="announcements-close-x" id="leekShopCloseX" aria-label="关闭">×</button>
      <div class="leek-shop-head">
        <h2 id="leekShopTitle">韭菜商店</h2>
        <span class="leek-shop-balance" id="leekShopBalance" aria-live="polite"></span>
      </div>
      <div class="leek-shop-tabs" id="leekShopTabs" role="tablist" aria-label="商品分类"></div>
      <div class="leek-shop-body" id="leekShopBody"></div>
    </div>
  </div>`.trim();
  document.body.appendChild(t.content.firstElementChild);
  const modal = $("leekShopModal");
  $("leekShopCloseX").addEventListener("click", closeLeekShop);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeLeekShop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeLeekShop(); });
  $("leekShopTabs").addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("[data-shop-tab]") : null;
    if (b) selectTab(b.getAttribute("data-shop-tab")).catch(() => {});
  });
}

function setBalance(n) {
  const el = $("leekShopBalance");
  if (el && Number.isFinite(Number(n))) el.textContent = `我的韭币 ${Number(n)}`;
}

async function resolveTabs() {
  const loaded = await Promise.all(
    TABS.map(async (t) => {
      try {
        const api = await t.load();
        return (await api.probe()) ? { ...t, api } : null;
      } catch {
        return null;
      }
    })
  );
  return loaded.filter(Boolean);
}

function paintTabs() {
  $("leekShopTabs").innerHTML = available
    .map((t) => `<button type="button" role="tab" class="leek-tab${t.id === current ? " is-active" : ""}" data-shop-tab="${t.id}" aria-selected="${t.id === current}">${t.label}</button>`)
    .join("");
}

async function selectTab(id) {
  const tab = (available || []).find((t) => t.id === id) || (available || [])[0];
  if (!tab) return;
  if (current && current !== tab.id) available.find((t) => t.id === current)?.mounted?.leave?.();
  current = tab.id;
  paintTabs();
  const body = $("leekShopBody");
  body.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.getAttribute("data-panel") !== tab.id; });
  if (!tab.panel) {
    tab.panel = document.createElement("div");
    tab.panel.className = `leek-panel leek-panel--${tab.id}`;
    tab.panel.setAttribute("data-panel", tab.id);
    tab.panel.setAttribute("role", "tabpanel");
    body.appendChild(tab.panel);
    tab.mounted = tab.api.mount(tab.panel, { balance: setBalance });
  }
  tab.panel.hidden = false;
  body.scrollTop = 0;
  await tab.mounted.refresh();
}

export function closeLeekShop() {
  (available || []).forEach((t) => t.mounted?.leave?.());
  const m = $("leekShopModal");
  if (m) closeCtlOverlay(m);
}

/** Open the shop, optionally on a tab ("frames" | "cos" | "titles" | "rename"). */
export async function openLeekShop(tabId) {
  if (!authed()) {
    document.getElementById("authLoginBtn")?.click();
    return;
  }
  if (opening) return opening;
  opening = (async () => {
    const authModal = $("authModal");
    if (authModal && !authModal.hidden) {
      const { closeAuthModal } = await import("./auth.js");
      closeAuthModal();
    }
    ensureModal();
    available = await resolveTabs();
    // Rebuild panels from scratch each time so a stale panel never shows another account's state.
    $("leekShopBody").innerHTML = "";
    current = null;
    available.forEach((t) => { t.panel = null; t.mounted = null; });
    if (!available.length) {
      const { showStampToast } = await import("./controls.js");
      showStampToast("商店暂未开放", "error");
      return;
    }
    openCtlOverlay($("leekShopModal"));
    await selectTab(tabId);
  })().finally(() => { opening = null; });
  return opening;
}

/** Show the top-bar button for signed-in players only. */
function syncEntry() {
  const btn = $("shopBtn");
  if (btn) btn.hidden = !authed();
}

export function initLeekShop() {
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-shop-open]") : null;
    if (t) { e.preventDefault(); openLeekShop(t.getAttribute("data-shop-open") || undefined).catch(() => {}); }
  });
  document.addEventListener("stockgame:auth-changed", syncEntry);
  syncEntry();
}
