/** 韭币 client: balance chrome + daily claim beside auth chip */
import { api, getAuthState, showToast } from "./auth.js";

const COIN_SVG = `<svg class="jiu-coin-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="10" fill="currentColor" opacity=".18"/>
  <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <path d="M12 7.2v9.6M9.2 9.4c.7-1 2-1.5 2.8-1.5 1.6 0 2.7 1 2.7 2.3 0 1.5-1.3 2.2-2.7 2.6-1.5.4-2.7 1-2.7 2.5 0 1.4 1.2 2.4 3 2.4 1 0 2-.4 2.7-1.2"
    fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

let claimBusy = false;

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
        ${COIN_SVG}
        <span id="jiuCoinBalanceVal">0</span>
      </span>
      <button type="button" class="jiu-coin-daily-btn" id="jiuCoinDailyBtn" title="每日领取韭币">每日领取</button>
    `;
    const loginBtn = document.getElementById("authLoginBtn");
    if (loginBtn) chip.insertBefore(wrap, loginBtn);
    else chip.appendChild(wrap);

    const btn = document.getElementById("jiuCoinDailyBtn");
    if (btn) btn.addEventListener("click", onDailyClaim);
  }
  return wrap;
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

async function onDailyClaim() {
  if (claimBusy) return;
  const auth = getAuthState();
  if (!auth.user) return;
  claimBusy = true;
  const btn = document.getElementById("jiuCoinDailyBtn");
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
    showToast(`领取成功 +${data.amount} 韭币`, "success");
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
    }
    await refreshJiuCoinStatus();
  } finally {
    claimBusy = false;
  }
}

export function initJiuCoin() {
  ensureCoinDom();
  renderJiuCoinChrome();
  document.addEventListener("stockgame:auth-changed", () => {
    refreshJiuCoinStatus();
  });
}
