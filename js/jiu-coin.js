/** 韭币 client: balance chrome + daily claim beside auth chip */
import { api, getAuthState, showToast } from "./auth.js";

/** Shared coin SVG markup (auth chrome, price badges, modals). */
export function coinIconHtml({ size = 18, className = "jiu-coin-icon" } = {}) {
  const s = Number(size) || 18;
  return `<svg class="${className}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".18"/>
  <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M12 7.2v9.6M9.2 9.4c.7-1 2-1.5 2.8-1.5 1.6 0 2.7 1 2.7 2.3 0 1.5-1.3 2.2-2.7 2.6-1.5.4-2.7 1-2.7 2.5 0 1.4 1.2 2.4 3 2.4 1 0 2-.4 2.7-1.2"
    fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/** Number + coin icon (icon after amount). */
export function amountWithCoinHtml(amount, { size = 12 } = {}) {
  const n = amount == null ? "" : String(amount);
  return `<span class="jiu-coin-amt"><span class="jiu-price-num">${n}</span>${coinIconHtml({ size })}</span>`;
}

let claimBusy = false;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function hydratePriceBadges() {
  document.querySelectorAll(".jiu-price-badge[data-jiu-price]").forEach((badge) => {
    const amount = badge.getAttribute("data-jiu-price");
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
        <span id="jiuCoinBalanceVal">0</span>
        ${coinIconHtml({ size: 18 })}
      </span>
      <button type="button" class="jiu-coin-daily-btn" id="jiuCoinDailyBtn" title="每日领取韭币">每日领取</button>
    `;
    const loginBtn = document.getElementById("authLoginBtn");
    if (loginBtn) chip.insertBefore(wrap, loginBtn);
    else chip.appendChild(wrap);

    const btn = document.getElementById("jiuCoinDailyBtn");
    if (btn) btn.addEventListener("click", onDailyClaimClick);
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
          <button type="button" class="jiu-coin-secondary" id="jiuCoinDailyCancel">取消</button>
          <button type="button" class="jiu-coin-primary" id="jiuCoinDailyConfirm">领取</button>
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
          <button type="button" class="jiu-coin-primary" id="jiuCoinSuccessOk">好的</button>
        </div>
      </div>
    </div>`)
  );

  const bindClose = (modalId, ...btnIds) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const hide = () => {
      modal.hidden = true;
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
  if (modal) modal.hidden = false;
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
  if (modal) modal.hidden = false;
}

function isAlreadyClaimedBtn(btn) {
  return !!(btn && (btn.classList.contains("is-claimed") || btn.textContent === "今日已领"));
}

export function renderJiuCoinChrome() {
  ensureCoinDom();
  const wrap = document.getElementById("jiuCoinChrome");
  const balEl = document.getElementById("jiuCoinBalanceVal");
  const btn = document.getElementById("jiuCoinDailyBtn");
  if (!wrap || !balEl) return;

  const auth = getAuthState();
  const logged = !!(auth.user);
  wrap.hidden = !logged;
  if (!logged) {
    balEl.textContent = "0";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "每日领取";
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
    if (btn) {
      if (data.claimedToday) {
        btn.disabled = true;
        btn.textContent = "今日已领";
        btn.classList.add("is-claimed");
      } else {
        btn.disabled = false;
        btn.textContent = "每日领取";
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
    confirmBtn.textContent = "领取中…";
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "领取中…";
  }
  try {
    const { data } = await api("/me/jiu-coin/daily", { method: "POST" });
    if (auth.user) auth.user.jiuCoinBalance = data.balance;
    renderJiuCoinChrome();
    if (btn) {
      btn.disabled = true;
      btn.textContent = "今日已领";
      btn.classList.add("is-claimed");
    }
    openSuccessModal(data.amount);
  } catch (e) {
    const msg = e?.message || "领取失败";
    showToast(msg, "error");
    if (e?.code === "ALREADY_CLAIMED_TODAY" || /已领取/.test(msg)) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "今日已领";
        btn.classList.add("is-claimed");
      }
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = "每日领取";
      btn.classList.remove("is-claimed");
    }
    await refreshJiuCoinStatus();
  } finally {
    claimBusy = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "领取";
    }
  }
}

export function initJiuCoin() {
  hydratePriceBadges();
  hydrateInlineCoinIcons();
  ensureCoinDom();
  renderJiuCoinChrome();
  document.addEventListener("stockgame:auth-changed", () => {
    refreshJiuCoinStatus();
  });
}
