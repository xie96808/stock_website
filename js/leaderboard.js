/** Stage 4: dual-mode + dual-metric public leaderboard (perf: per-panel cache + prefetch) */
import { getAuthState, openAuthModal, api } from "./auth.js";

const REASON_TEXT = {
  not_opted_in: "尚未开启排行榜参与，可在设置中打开",
  no_eligible_game: "暂无有效上榜战绩（需至少一笔买入的已结算局）",
  admin_role: "管理员成绩不进入公共榜",
  account_not_active: "账号当前不可参与排行榜",
};

const MODES = ["next_open", "same_close"];
const METRICS = ["best", "average"];

/** @type {Map<string, { data: object, fetchedAt: number }>} */
const panelCache = new Map();

/** In-flight fetches keyed by panelKey (dedupe + race guard). */
const inflight = new Map();

let activeLoadToken = 0;
/** @type {"best"|"average"} */
let activeMetric = "best";
/** @type {"next_open"|"same_close"} */
let activeFillMode = "next_open";

function panelKey(metric, fillMode) {
  return `${metric}|${fillMode}`;
}

function hideOtherScreens() {
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "block";
    hdr.classList.add("compact");
  }
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "none";
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
    return `images/avatars/${n}.png`;
  }
  const n = String(rowOrId || 1).padStart(2, "0");
  return `images/avatars/${n}.png`;
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

function setBusy(screen, busy) {
  if (!screen) return;
  screen.classList.toggle("is-busy", !!busy);
  const meta = screen.querySelector("#leaderboardMeta");
  if (meta) meta.classList.toggle("is-refreshing", !!busy);
}

function retLabel(metric) {
  return metric === "average" ? "平均收益" : "收益率";
}

function syncMetricNote(metric) {
  const note = document.getElementById("leaderboardMetricNote");
  if (!note) return;
  if (metric === "average") {
    note.hidden = false;
    note.textContent =
      "平均收益 = 各有效上榜局 return 的算术平均（非百分比点相加），不等于一笔资金的连续复利结果。示例：+40% 与 −10% 两局，平均为 +15%，不是综合 +30%。";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function renderPanel(data) {
  const listEl = document.getElementById("leaderboardList");
  const metaEl = document.getElementById("leaderboardMeta");
  const mineEl = document.getElementById("leaderboardMine");
  const metric = data.metric === "average" ? "average" : "best";
  syncMetricNote(metric);
  if (metaEl) {
    const metricLabel = metric === "average" ? "平均收益" : "最佳单局";
    metaEl.innerHTML = `${escapeHtml(metricLabel)} · 规则 <code>${escapeHtml(data.ruleVersion)}</code> · 行情 <code>${escapeHtml(
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
  const label = retLabel(metric);
  listEl.innerHTML = items
    .map((row) => {
      const cls =
        row.returnPpm > 0 ? "pos" : row.returnPpm < 0 ? "neg" : "";
      const stats = fmtWinStats(row.gameCount, row.winRate);
      return `<li class="leaderboard-row">
          <span class="lb-rank">#${row.rank}</span>
          <img class="lb-avatar" src="${avatarUrl(row)}" alt="" loading="lazy" decoding="async" width="40" height="40">
          <span class="lb-nick">${escapeHtml(row.nickname)}<small class="lb-stats">${escapeHtml(stats)}</small></span>
          <span class="lb-ret ${cls}" title="${escapeHtml(label)}"><small class="lb-ret-label">${escapeHtml(label)}</small>${fmtPct(row.returnPpm, row.returnPct)}</span>
          <span class="lb-time">${fmtFinished(row.finishedAt)}</span>
        </li>`;
    })
    .join("");
}

async function fetchLeaderboard(metric, fillMode) {
  const key = panelKey(metric, fillMode);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const qs = new URLSearchParams({ fillMode, metric });
    const { data } = await api(`/leaderboard?${qs.toString()}`);
    panelCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

function prefetchOtherPanels(metric, fillMode) {
  for (const m of METRICS) {
    for (const mode of MODES) {
      if (m === metric && mode === fillMode) continue;
      const key = panelKey(m, mode);
      if (panelCache.has(key) || inflight.has(key)) continue;
      fetchLeaderboard(m, mode).catch(() => {});
    }
  }
}

function bindTabHandlers(screen) {
  screen.querySelectorAll(".leaderboard-metric-tab").forEach((btn) => {
    btn.onclick = () => {
      screen.querySelectorAll(".leaderboard-metric-tab").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      activeMetric = btn.dataset.metric === "average" ? "average" : "best";
      loadLeaderboardPanel(activeMetric, activeFillMode);
    };
  });
  screen.querySelectorAll(".leaderboard-tab").forEach((btn) => {
    btn.onclick = () => {
      screen.querySelectorAll(".leaderboard-tab").forEach((b) => b.classList.toggle("active", b === btn));
      activeFillMode = btn.dataset.mode === "same_close" ? "same_close" : "next_open";
      loadLeaderboardPanel(activeMetric, activeFillMode);
    };
  });
}

/** @param {string} [preferredFillMode] next_open | same_close — selects matching tab when opening. */
export async function showLeaderboard(preferredFillMode) {
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
        <div class="leaderboard-metric-tabs" role="tablist" aria-label="榜单类型">
          <button type="button" class="leaderboard-metric-tab active" data-metric="best" role="tab" aria-selected="true">最佳单局</button>
          <button type="button" class="leaderboard-metric-tab" data-metric="average" role="tab" aria-selected="false">平均收益</button>
        </div>
        <div class="leaderboard-tabs" role="tablist" aria-label="成交模式">
          <button type="button" class="leaderboard-tab active" data-mode="next_open" role="tab">次日开盘榜</button>
          <button type="button" class="leaderboard-tab" data-mode="same_close" role="tab">当日收盘榜</button>
        </div>
        <div class="leaderboard-meta" id="leaderboardMeta">加载中…</div>
        <div class="leaderboard-mine" id="leaderboardMine"></div>
        <ol class="leaderboard-list" id="leaderboardList"></ol>
        <p class="leaderboard-note">公开仅展示昵称与头像，不含登录名。收益按内部精度排序，显示四舍五入后可能相同。</p>
        <p class="leaderboard-note leaderboard-metric-note" id="leaderboardMetricNote" hidden></p>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    screen.querySelector("#leaderboardBackBtn").onclick = hideLeaderboard;
    bindTabHandlers(screen);
  }
  screen.classList.add("active");
  screen.style.display = "block";
  const want = preferredFillMode === "same_close" || preferredFillMode === "next_open"
    ? preferredFillMode
    : null;
  if (want) {
    activeFillMode = want;
    screen.querySelectorAll(".leaderboard-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === want);
    });
  } else {
    activeFillMode =
      screen.querySelector(".leaderboard-tab.active")?.dataset.mode || "next_open";
  }
  activeMetric =
    screen.querySelector(".leaderboard-metric-tab.active")?.dataset.metric || "best";
  screen.querySelectorAll(".leaderboard-metric-tab").forEach((b) => {
    const on = b.dataset.metric === activeMetric;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  await loadLeaderboardPanel(activeMetric, activeFillMode);
}

export function hideLeaderboard() {
  const screen = document.getElementById("leaderboardScreen");
  if (screen) {
    screen.classList.remove("active");
    screen.style.display = "none";
    setBusy(screen, false);
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

async function loadLeaderboardPanel(metric, fillMode) {
  const screen = document.getElementById("leaderboardScreen");
  const listEl = document.getElementById("leaderboardList");
  const metaEl = document.getElementById("leaderboardMeta");
  const mineEl = document.getElementById("leaderboardMine");
  const token = ++activeLoadToken;
  const key = panelKey(metric, fillMode);

  const cached = panelCache.get(key);
  if (cached?.data) {
    renderPanel(cached.data);
    setBusy(screen, true);
  } else {
    if (listEl) listEl.innerHTML = `<li class="leaderboard-empty">加载中…</li>`;
    syncMetricNote(metric);
    setBusy(screen, true);
  }

  try {
    const data = await fetchLeaderboard(metric, fillMode);
    if (token !== activeLoadToken) return;
    renderPanel(data);
    prefetchOtherPanels(metric, fillMode);
  } catch (e) {
    if (token !== activeLoadToken) return;
    if (!cached?.data) {
      if (metaEl) metaEl.textContent = e.message || "加载失败";
      if (listEl) listEl.innerHTML = "";
      if (mineEl) mineEl.innerHTML = "";
    } else if (metaEl) {
      metaEl.insertAdjacentHTML(
        "beforeend",
        ` <span class="lb-refresh-err">（刷新失败：${escapeHtml(e.message || "网络错误")}）</span>`
      );
    }
  } finally {
    if (token === activeLoadToken) setBusy(screen, false);
  }
}

/** Clear client cache after settle / opt-in so next open is fresh. */
export function invalidateLeaderboardClientCache() {
  panelCache.clear();
}

export function initLeaderboardRouting() {
  const apply = () => {
    const h = (location.hash || "").replace(/^#\/?/, "");
    if (h === "leaderboard") showLeaderboard();
  };
  window.addEventListener("hashchange", apply);
  apply();
}
