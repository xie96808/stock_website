/** Stage 4: dual-mode + dual-metric public leaderboard (perf: per-panel cache + prefetch) */
import { getAuthState, openAuthModal, api } from "./auth.js";
import { getRewindTickets } from "./rewind-tickets.js";
import {
  Route,
  prepareScreen,
  activateScreen,
  deactivateScreen,
  setRouteHash,
  setHeaderChrome,
  parseRouteHash,
} from "./screen-router.js";
import { formatShanghaiDateTime } from "./time.js";
import { RECENT_STATUS_TEXT } from "./lb-verdict.js";

const REASON_TEXT = {
  not_opted_in: "尚未列入排行榜，打开资料设置并保存即可参与",
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
/** @type {"clean"|"undo"|"all"|null} */
let activeAssist = "clean";
let gameRewindEnabled = false;
/** @type {"best"|"average"} */
let activeMetric = "best";
/** @type {"next_open"|"same_close"} */
let activeFillMode = "next_open";
/** @type {"classic"|"oneshot"|"survival"} */
let activeGameKind = "classic";
let oneshotModeEnabled = false;
let survivalModeEnabled = false;

function panelKey(metric, fillMode, assistClass = activeAssist, gameKind = activeGameKind) {
  return `${metric}|${fillMode}|${assistClass || "_all"}|${gameKind || "classic"}`;
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
  const formatted = formatShanghaiDateTime(iso);
  if (!formatted) return "—";
  // Helper echoes raw on hard failure; escape that path for HTML safety.
  return formatted === String(iso) ? escapeHtml(formatted) : formatted;
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

/** Track R3: 后悔券 rewinds keep a game on the 纯净 board (rewindTicketBoard 'clean'), so say so there. */
function syncAssistNote() {
  const el = document.getElementById("leaderboardAssistNote");
  if (!el) return;
  const t = getRewindTickets();
  const show = activeGameKind === "classic" && gameRewindEnabled && activeAssist === "clean" && t.known && t.board === "clean";
  el.hidden = !show;
  el.textContent = show ? "纯净榜含使用后悔券的对局（后悔券回退一次，仍按普通对局计入）。" : "";
}

function syncMetricNote(metric) {
  syncAssistNote();
  const note = document.getElementById("leaderboardMetricNote");
  if (!note) return;
  if (activeGameKind === "survival" && metric === "best") {
    note.hidden = false;
    note.textContent =
      "生存榜优先排「活穿」局（未爆仓），同档再按收益率。爆仓局仍可上榜，但排在活穿之后。";
  } else if (metric === "average") {
    note.hidden = false;
    note.textContent =
      "平均收益 = 各有效上榜局 return 的算术平均（非百分比点相加），不等于一笔资金的连续复利结果。示例：+40% 与 −10% 两局，平均为 +15%，不是综合 +30%。";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function renderRecent(data) {
  const rec = Array.isArray(data.myRecent) ? data.myRecent : [];
  if (!rec.length) return "";
  const rows = rec
    .map((g) => {
      const cls = g.returnPpm > 0 ? "pos" : g.returnPpm < 0 ? "neg" : "";
      const txt = g.status === "counted"
        ? (g.isBest ? "当前最佳 · 计入榜单" : "已计入 · 非个人最佳")
        : (RECENT_STATUS_TEXT[g.status] || "未计入");
      const undo = g.assistClass === "undo" ? " · 反悔" : "";
      return `<li class="lb-recent-row${g.status === "counted" ? "" : " is-off"}">
          <span class="lb-recent-ret ${cls}">${fmtPct(g.returnPpm, g.returnPct)}</span>
          <span class="lb-recent-txt">${escapeHtml(txt + undo)}</span>
          <span class="lb-recent-time">${fmtFinished(g.finishedAt)}</span>
        </li>`;
    })
    .join("");
  return `<div class="lb-recent"><div class="lb-recent-title">我的最近对局（每局都有记录，榜单按个人最佳单局排名）</div><ul class="lb-recent-list">${rows}</ul></div>`;
}

function renderPanel(data) {
  const listEl = document.getElementById("leaderboardList");
  const metaEl = document.getElementById("leaderboardMeta");
  const mineEl = document.getElementById("leaderboardMine");
  const metric = data.metric === "average" ? "average" : "best";
  syncMetricNote(metric);
  if (metaEl) {
    const metricLabel = metric === "average" ? "平均收益" : "最佳单局";
    const kindLabel =
      data.gameKind === "oneshot"
        ? "一把梭"
        : data.gameKind === "survival"
          ? "活过三十日"
          : "经典练习";
    const assistLabel =
      data.gameKind && data.gameKind !== "classic"
        ? null
        : data.assistClass === "undo"
          ? "反悔"
          : data.assistClass === "all"
            ? "总榜"
            : data.assistClass === "clean"
              ? "纯净"
              : null;
    const assistBit = assistLabel ? ` · ${escapeHtml(assistLabel)}` : "";
    metaEl.innerHTML = `${escapeHtml(kindLabel)} · ${escapeHtml(metricLabel)}${assistBit} · 规则 <code>${escapeHtml(data.ruleVersion)}</code> · 行情 <code>${escapeHtml(
      String(data.datasetVersion || "").slice(0, 12)
    )}…</code> · 更新于 ${fmtFinished(data.asOf)}`;
  }
  const auth = getAuthState();
  if (mineEl) {
    if (!auth.user) {
      mineEl.innerHTML = `<div class="mine-card guest">游客可浏览榜单。登录后即可显示你的名次。
          <button type="button" class="leaderboard-link" id="lbLoginBtn">登录 / 注册</button></div>`;
      mineEl.querySelector("#lbLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    } else if (data.myRank != null) {
      const stats = fmtWinStats(data.myGameCount, data.myWinRate);
      mineEl.innerHTML = `<div class="mine-card">你的名次：<strong>#${data.myRank}</strong>
          <span class="mine-stats">${escapeHtml(stats)} · 共 ${Number(data.total || 0)} 人上榜</span></div>`;
    } else {
      const reason = REASON_TEXT[data.ineligibilityReason] || "暂未上榜";
      const optBtn =
        data.ineligibilityReason === "not_opted_in"
          ? `<button type="button" class="leaderboard-link" id="lbSettingsBtn">打开资料设置并保存</button>`
          : "";
      mineEl.innerHTML = `<div class="mine-card">${escapeHtml(reason)} ${optBtn}</div>`;
      mineEl.querySelector("#lbSettingsBtn")?.addEventListener("click", () => openAuthModal("settings"));
    }
  }
  if (mineEl && auth.user) mineEl.insertAdjacentHTML("beforeend", renderRecent(data));
  const items = data.top10 || [];
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = `<li class="leaderboard-empty">还没有有效成绩，完成一局试试</li>`;
    return;
  }
  const label = retLabel(metric);
  const survivalBoard = data.gameKind === "survival";
  const meRank = auth.user ? data.myRank : null;
  const rowHtml = (row, extraCls = "") => {
      const cls =
        row.returnPpm > 0 ? "pos" : row.returnPpm < 0 ? "neg" : "";
      const stats = fmtWinStats(row.gameCount, row.winRate);
      const survBadge = survivalBoard
        ? row.busted
          ? `<small class="lb-survive-badge lb-survive-bust">爆仓</small>`
          : `<small class="lb-survive-badge lb-survive-ok">活穿</small>`
        : "";
      return `<li class="leaderboard-row${survivalBoard ? (row.busted ? " lb-row-bust" : " lb-row-survive") : ""}${extraCls}">
          <span class="lb-rank">#${row.rank}</span>
          <img class="lb-avatar" src="${avatarUrl(row)}" alt="" loading="lazy" decoding="async" width="40" height="40">
          <span class="lb-nick"><span class="lb-nick-name">${escapeHtml(row.nickname)}${extraCls ? '<small class="lb-me-tag">我</small>' : ""}${survBadge}</span><small class="lb-stats">${escapeHtml(stats)}</small></span>
          <span class="lb-ret ${cls}" title="${escapeHtml(label)}"><small class="lb-ret-label">${escapeHtml(label)}</small>${fmtPct(row.returnPpm, row.returnPct)}</span>
          <span class="lb-time">${fmtFinished(row.finishedAt)}</span>
        </li>`;
  };
  const tail = data.myEntry
    ? `<li class="leaderboard-gap" aria-hidden="true">⋯</li>` + rowHtml(data.myEntry, " is-me")
    : "";
  listEl.innerHTML = items.map((row) => rowHtml(row, meRank != null && row.rank === meRank ? " is-me" : "")).join("") + tail;
}

async function fetchLeaderboard(metric, fillMode, assistClass = activeAssist, gameKind = activeGameKind) {
  const key = panelKey(metric, fillMode, assistClass, gameKind);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const qs = new URLSearchParams({ fillMode, metric, gameKind: gameKind || "classic" });
    if (gameKind === "classic" && gameRewindEnabled && assistClass) qs.set("assistClass", assistClass);
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
      const key = panelKey(m, mode, activeAssist, activeGameKind);
      if (panelCache.has(key) || inflight.has(key)) continue;
      fetchLeaderboard(m, mode, activeAssist, activeGameKind).catch(() => {});
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
  screen.querySelectorAll(".leaderboard-assist-tab").forEach((btn) => {
    btn.onclick = () => {
      screen.querySelectorAll(".leaderboard-assist-tab").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      const a = btn.dataset.assist;
      activeAssist = a === "undo" || a === "all" ? a : "clean";
      loadLeaderboardPanel(activeMetric, activeFillMode);
    };
  });
  screen.querySelectorAll(".leaderboard-kind-tab").forEach((btn) => {
    btn.onclick = () => {
      screen.querySelectorAll(".leaderboard-kind-tab").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      const k = btn.dataset.kind;
      activeGameKind = k === "oneshot" || k === "survival" ? k : "classic";
      syncAssistTabsVisibility(screen);
      loadLeaderboardPanel(activeMetric, activeFillMode);
    };
  });
}

function syncAssistTabsVisibility(screen) {
  const assistTabs = screen?.querySelector("#leaderboardAssistTabs");
  if (!assistTabs) return;
  const showAssist = activeGameKind === "classic" && gameRewindEnabled;
  assistTabs.hidden = !showAssist;
  if (!showAssist) {
    /* keep activeAssist for when user returns to classic */
  } else if (!activeAssist) {
    activeAssist = "clean";
  }
}

function syncKindTabsVisibility(screen) {
  const wrap = screen?.querySelector("#leaderboardKindTabs");
  if (!wrap) return;
  const showExtra = oneshotModeEnabled || survivalModeEnabled;
  wrap.hidden = !showExtra;
  wrap.querySelectorAll('[data-kind="oneshot"]').forEach((b) => {
    b.hidden = !oneshotModeEnabled;
  });
  wrap.querySelectorAll('[data-kind="survival"]').forEach((b) => {
    b.hidden = !survivalModeEnabled;
  });
  if (activeGameKind === "oneshot" && !oneshotModeEnabled) activeGameKind = "classic";
  if (activeGameKind === "survival" && !survivalModeEnabled) activeGameKind = "classic";
  wrap.querySelectorAll(".leaderboard-kind-tab").forEach((b) => {
    const on = b.dataset.kind === activeGameKind;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  screen?.classList.toggle("lb-kind-oneshot", activeGameKind === "oneshot");
  screen?.classList.toggle("lb-kind-survival", activeGameKind === "survival");
  screen?.classList.toggle("lb-kind-classic", activeGameKind === "classic");
}

/**
 * @param {string|{fillMode?: string, gameKind?: string}} [preferred]
 *   string = fillMode (next_open | same_close); object may set fillMode + gameKind.
 */
export async function showLeaderboard(preferred) {
  let preferredFillMode;
  let preferredGameKind;
  if (preferred && typeof preferred === "object") {
    preferredFillMode = preferred.fillMode;
    preferredGameKind = preferred.gameKind;
  } else {
    preferredFillMode = preferred;
  }
  prepareScreen(Route.LEADERBOARD);
  setRouteHash(Route.LEADERBOARD);
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
        <div class="leaderboard-kind-tabs" id="leaderboardKindTabs" role="tablist" aria-label="玩法榜" hidden>
          <button type="button" class="leaderboard-kind-tab active" data-kind="classic" role="tab" aria-selected="true">经典练习</button>
          <button type="button" class="leaderboard-kind-tab lb-kind-tab-oneshot" data-kind="oneshot" role="tab" aria-selected="false" hidden>一把梭</button>
          <button type="button" class="leaderboard-kind-tab lb-kind-tab-survival" data-kind="survival" role="tab" aria-selected="false" hidden>活过三十日</button>
        </div>
        <div class="leaderboard-metric-tabs" role="tablist" aria-label="榜单类型">
          <button type="button" class="leaderboard-metric-tab active" data-metric="best" role="tab" aria-selected="true">最佳单局</button>
          <button type="button" class="leaderboard-metric-tab" data-metric="average" role="tab" aria-selected="false">平均收益</button>
        </div>
        <div class="leaderboard-assist-tabs" id="leaderboardAssistTabs" role="tablist" aria-label="辅助分类" hidden>
          <button type="button" class="leaderboard-assist-tab active" data-assist="clean" role="tab" aria-selected="true">纯净</button>
          <button type="button" class="leaderboard-assist-tab" data-assist="undo" role="tab" aria-selected="false">反悔</button>
          <button type="button" class="leaderboard-assist-tab" data-assist="all" role="tab" aria-selected="false">总榜</button>
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
        <p class="leaderboard-note leaderboard-assist-note" id="leaderboardAssistNote" hidden></p>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    screen.querySelector("#leaderboardBackBtn").onclick = hideLeaderboard;
    bindTabHandlers(screen);
  }
  activateScreen(Route.LEADERBOARD);
  try {
    const res = await fetch("/api/v1/config", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => ({}));
    gameRewindEnabled = !!(json?.data?.features?.gameRewind);
    oneshotModeEnabled = !!(json?.data?.features?.oneshotMode);
    survivalModeEnabled = !!(json?.data?.features?.survivalMode);
  } catch {
    gameRewindEnabled = false;
    oneshotModeEnabled = false;
    survivalModeEnabled = false;
  }
  if (preferredGameKind === "oneshot" || preferredGameKind === "survival" || preferredGameKind === "classic") {
    activeGameKind = preferredGameKind;
  }
  syncKindTabsVisibility(screen);
  if (!gameRewindEnabled) activeAssist = null;
  else if (!activeAssist) activeAssist = "clean";
  syncAssistTabsVisibility(screen);
  screen.querySelectorAll(".leaderboard-assist-tab").forEach((b) => {
    const on = b.dataset.assist === (activeAssist || "clean");
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
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
  if (screen) setBusy(screen, false);
  deactivateScreen(Route.LEADERBOARD);
  // Return to 模拟盘 hub (Scheme A); keep /#/sim deep link
  if (typeof window.restoreSimShell === "function") {
    window.restoreSimShell();
    return;
  }
  setHeaderChrome("hidden");
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "flex";
  if (parseRouteHash() === "leaderboard") {
    setRouteHash(Route.HOME);
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

/** @deprecated Use initAppHashRouting + registerHashRoute(Route.LEADERBOARD). */
export function initLeaderboardRouting() {
  if (parseRouteHash() === "leaderboard") showLeaderboard();
}
