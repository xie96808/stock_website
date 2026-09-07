/** Stage 4: dual-mode public leaderboard */
import { getAuthState, openAuthModal, api } from "./auth.js";

const REASON_TEXT = {
  not_opted_in: "尚未开启排行榜参与，可在设置中打开",
  no_eligible_game: "暂无有效上榜战绩（需至少一笔买入的已结算局）",
  admin_role: "管理员成绩不进入公共榜",
  account_not_active: "账号当前不可参与排行榜",
};

function hideOtherScreens() {
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "block";
    hdr.classList.add("compact");
  }
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "none";
  const cs = document.getElementById("comingSoonScreen");
  if (cs) {
    cs.classList.remove("active");
    cs.style.display = "none";
  }
  document.getElementById("gameScreen")?.classList.remove("active");
  document.getElementById("resultScreen")?.classList.remove("active");
  document.getElementById("academyScreen")?.classList.remove("active");
  document.getElementById("hindsightScreen")?.classList.remove("active");
  const my = document.getElementById("myGamesScreen");
  if (my) {
    my.classList.remove("active");
    my.style.display = "none";
  }
}

function fmtPct(ppm, pct) {
  if (pct != null && pct !== "") {
    const n = Number(pct);
    if (Number.isFinite(n)) return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  if (ppm == null) return "—";
  const v = ppm / 10000;
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function avatarUrl(rowOrId) {
  if (rowOrId && typeof rowOrId === "object") {
    if (rowOrId.avatarUrl) return rowOrId.avatarUrl;
    const n = String(rowOrId.avatarId || 1).padStart(2, "0");
    return `images/avatars/${n}.svg`;
  }
  const n = String(rowOrId || 1).padStart(2, "0");
  return `images/avatars/${n}.svg`;
}

function fmtWinStats(gameCount, winRate) {
  if (!gameCount) return "暂无有效局";
  const wr = winRate == null ? "—" : `${winRate}%`;
  return `胜率 ${wr} · ${gameCount} 局`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtFinished(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return escapeHtml(String(iso).slice(0, 19));
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch {
    return escapeHtml(String(iso).slice(0, 19));
  }
}

export async function showLeaderboard() {
  hideOtherScreens();
  if (location.hash !== "#/leaderboard") {
    try {
      history.replaceState(null, "", "#/leaderboard");
    } catch {
      location.hash = "#/leaderboard";
    }
  }
  let screen = document.getElementById("leaderboardScreen");
  if (!screen) {
    screen = document.createElement("section");
    screen.id = "leaderboardScreen";
    screen.className = "leaderboard-screen active";
    screen.innerHTML = `
      <div class="leaderboard-wrap">
        <div class="leaderboard-head">
          <button type="button" class="leaderboard-back" id="leaderboardBackBtn">← 返回</button>
          <h2>排行榜</h2>
        </div>
        <div class="leaderboard-tabs" role="tablist">
          <button type="button" class="leaderboard-tab active" data-mode="next_open" role="tab">次日开盘榜</button>
          <button type="button" class="leaderboard-tab" data-mode="same_close" role="tab">当日收盘榜</button>
        </div>
        <div class="leaderboard-meta" id="leaderboardMeta">加载中…</div>
        <div class="leaderboard-mine" id="leaderboardMine"></div>
        <ol class="leaderboard-list" id="leaderboardList"></ol>
        <p class="leaderboard-note">公开仅展示昵称与头像，不含登录名。收益按内部精度排序，显示四舍五入后可能相同。</p>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    screen.querySelector("#leaderboardBackBtn").onclick = hideLeaderboard;
    screen.querySelectorAll(".leaderboard-tab").forEach((btn) => {
      btn.onclick = () => {
        screen.querySelectorAll(".leaderboard-tab").forEach((b) => b.classList.toggle("active", b === btn));
        loadLeaderboardPanel(btn.dataset.mode);
      };
    });
  }
  screen.classList.add("active");
  screen.style.display = "block";
  const mode =
    screen.querySelector(".leaderboard-tab.active")?.dataset.mode || "next_open";
  await loadLeaderboardPanel(mode);
}

export function hideLeaderboard() {
  const screen = document.getElementById("leaderboardScreen");
  if (screen) {
    screen.classList.remove("active");
    screen.style.display = "none";
  }
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "none";
    hdr.classList.remove("compact");
  }
  // Return to 模拟盘 hub (Scheme A); keep /#/sim deep link
  if (typeof window.restoreSimShell === "function") {
    window.restoreSimShell();
    return;
  }
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "flex";
  if (location.hash === "#/leaderboard") {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      location.hash = "";
    }
  }
}

async function loadLeaderboardPanel(fillMode) {
  const listEl = document.getElementById("leaderboardList");
  const metaEl = document.getElementById("leaderboardMeta");
  const mineEl = document.getElementById("leaderboardMine");
  if (listEl) listEl.innerHTML = `<li class="leaderboard-empty">加载中…</li>`;
  try {
    const qs = new URLSearchParams({ fillMode });
    const { data } = await api(`/leaderboard?${qs.toString()}`);
    if (metaEl) {
      metaEl.innerHTML = `规则 <code>${escapeHtml(data.ruleVersion)}</code> · 行情 <code>${escapeHtml(
        String(data.datasetVersion || "").slice(0, 12)
      )}…</code> · 更新于 ${fmtFinished(data.asOf)}`;
    }
    const auth = getAuthState();
    if (mineEl) {
      if (!auth.user) {
        mineEl.innerHTML = `<div class="mine-card guest">游客可浏览榜单。登录并在设置中开启「参与排行榜」后显示你的名次。
          <button type="button" class="leaderboard-link" id="lbLoginBtn">登录 / 注册</button></div>`;
        mineEl.querySelector("#lbLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
      } else if (data.myRank != null) {
        const stats = fmtWinStats(data.myGameCount, data.myWinRate);
        mineEl.innerHTML = `<div class="mine-card">你的名次：<strong>#${data.myRank}</strong>
          <span class="mine-stats">${escapeHtml(stats)}</span></div>`;
      } else {
        const reason = REASON_TEXT[data.ineligibilityReason] || "暂未上榜";
        const optBtn =
          data.ineligibilityReason === "not_opted_in"
            ? `<button type="button" class="leaderboard-link" id="lbSettingsBtn">打开设置</button>`
            : "";
        mineEl.innerHTML = `<div class="mine-card">${escapeHtml(reason)} ${optBtn}</div>`;
        mineEl.querySelector("#lbSettingsBtn")?.addEventListener("click", () => openAuthModal("settings"));
      }
    }
    const items = data.top10 || [];
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = `<li class="leaderboard-empty">还没有有效成绩，完成一局试试</li>`;
      return;
    }
    listEl.innerHTML = items
      .map((row) => {
        const cls =
          row.returnPpm > 0 ? "pos" : row.returnPpm < 0 ? "neg" : "";
        const stats = fmtWinStats(row.gameCount, row.winRate);
        return `<li class="leaderboard-row">
          <span class="lb-rank">#${row.rank}</span>
          <img class="lb-avatar" src="${avatarUrl(row)}" alt="">
          <span class="lb-nick">${escapeHtml(row.nickname)}<small class="lb-stats">${escapeHtml(stats)}</small></span>
          <span class="lb-ret ${cls}">${fmtPct(row.returnPpm, row.returnPct)}</span>
          <span class="lb-time">${fmtFinished(row.finishedAt)}</span>
        </li>`;
      })
      .join("");
  } catch (e) {
    if (metaEl) metaEl.textContent = e.message || "加载失败";
    if (listEl) listEl.innerHTML = "";
    if (mineEl) mineEl.innerHTML = "";
  }
}

export function initLeaderboardRouting() {
  const apply = () => {
    const h = (location.hash || "").replace(/^#\/?/, "");
    if (h === "leaderboard") showLeaderboard();
  };
  window.addEventListener("hashchange", apply);
  apply();
}
